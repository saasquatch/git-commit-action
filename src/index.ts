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
const TYPE = { BLOB: "blob", TREE: "tree" };

async function main(): Promise<void> {
  const GITHUB_TOKEN = requiredEnv("GITHUB_TOKEN");

  const repo = core.getInput("repository");
  const branch = core.getInput("branch");
  const message = core.getInput("message");
  const longMessage = core.getInput("long-message");
  const files = core.getMultilineInput("files");

  const [repoOwner, repoName] = repo.split("/");

  // See: https://docs.github.com/en/free-pro-team@latest/rest/reference/git#commits
  const commitsUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/git/commits`;

  // See: https://docs.github.com/en/free-pro-team@latest/rest/reference/git#trees
  const treeUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees`;

  // See: https://docs.github.com/en/free-pro-team@latest/rest/reference/git#get-a-reference
  const refUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/git/refs/heads/${branch}`;

  const headers = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `Bearer ${GITHUB_TOKEN}`,
  };

  // Get the sha of the last commit on BRANCH_NAME
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
          : { sha: null }),
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

  // Make BRANCH_NAME point to the created commit
  await axios({
    url: refUrl,
    method: "POST",
    headers,
    data: { sha: newCommitSha },
  });
}

main().catch((e) => {
  const formattedError = JSON.stringify(
    {
      e,
      eStr: `${e}`,
      eJson: JSON.stringify(e),
    },
    null,
    2,
  );

  core.setFailed(`Action failed: ${formattedError}`);
});
