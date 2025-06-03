/**
 *
 * Originally based on https://gist.github.com/quilicicf/41e241768ab8eeec1529869777e996f0
 *
 */
import axios from "axios";
import * as core from "@actions/core";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

export const requiredEnv = (key: string) => {
  const val = process.env[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`Missing required environment variable: "${key}"`);
  }
  return val;
};

const MODES = { FILE: "100644", FOLDER: "040000" };
const TYPE = { BLOB: "blob", TREE: "tree", COMMIT: "commit" };

async function main(): Promise<void> {
  const GITHUB_TOKEN = requiredEnv("GITHUB_TOKEN");

  const repo = core.getInput("repository");
  const branch = core.getInput("branch");
  const message = core.getInput("message");
  const longMessage = core.getInput("long-message");
  const tag = core.getInput("tag");
  const tagMessage = core.getInput("tag-message");
  const files = core.getMultilineInput("files");

  // we'll check this first so that we don't create all the trees & commits
  // and stuff before erroring out at the tag step
  if (tag && !tagMessage) {
    core.setFailed("`tag-message` is required if `tag` is specified");
    return;
  }

  if (files.length === 0) {
    core.setFailed("Must specifiy at least one file to stage & commit");
    return;
  }

  const [repoOwner, repoName] = repo.split("/");

  if (!repoOwner || !repoName) {
    core.setFailed(
      `Failed to extract repo owner and name from string "${repo}"`,
    );
    return;
  }

  const baseUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/git`;
  const commitsUrl = `${baseUrl}/commits`;
  const treeUrl = `${baseUrl}/trees`;
  const refUrl = `${baseUrl}/refs/heads/${branch}`;
  const tagObjectUrl = `${baseUrl}/tags`;
  const tagRefUrl = `${baseUrl}/refs`;

  const headers = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `Bearer ${GITHUB_TOKEN}`,
  };

  // Get the sha of the last commit on selected branch
  const {
    data: {
      object: { sha: currentCommitSha },
    },
  } = await axios({ url: refUrl, headers });

  // Get the sha of the root tree on the commit retrieved previously
  const currentCommitUrl = `${commitsUrl}/${currentCommitSha}`;
  const {
    data: {
      tree: { sha: treeSha },
    },
  } = await axios({ url: currentCommitUrl, headers });

  const treeInput = await Promise.all(
    files.map(async (file) => {
      return {
        path: file,
        mode: MODES.FILE,
        type: TYPE.BLOB,
        ...(existsSync(file)
          ? { content: await readFile(file, "utf8") }
          : // if the file doesn't exist setting the sha to null means "deletion"
            { sha: null }),
      };
    }),
  );

  // Create a tree to edit the content of the repository
  const {
    data: { sha: newTreeSha },
  } = await axios({
    url: treeUrl,
    method: "POST",
    headers,
    data: { base_tree: treeSha, tree: treeInput },
  });

  // Create a commit that uses the tree created above
  const {
    data: { sha: newCommitSha },
  } = await axios({
    url: commitsUrl,
    method: "POST",
    headers,
    data: {
      message: longMessage ? `${message}\n\n${longMessage}` : message,
      tree: newTreeSha,
      parents: [currentCommitSha],
    },
  });

  // Make the selected branch point to the created commit
  await axios({
    url: refUrl,
    method: "POST",
    headers,
    data: { sha: newCommitSha },
  });

  if (tag) {
    // Create a new tag object pointing to the commit we just made
    // and with the specified tag + message
    const {
      data: { sha: newTagSha },
    } = await axios({
      url: tagObjectUrl,
      method: "POST",
      headers,
      data: {
        tag,
        message: tagMessage,
        object: newCommitSha,
        type: TYPE.COMMIT,
      },
    });

    // Create a new tag ref pointing to the tag object we just made
    await axios({
      url: tagRefUrl,
      method: "POST",
      headers,
      data: {
        ref: `refs/tags/${tag}`,
        sha: newTagSha,
      },
    });
  }
}

main().catch((e) => {
  const formattedError = JSON.stringify(
    { e, eStr: `${e}`, eJson: JSON.stringify(e) },
    null,
    2,
  );

  core.setFailed(`Action failed: ${formattedError}`);
});
