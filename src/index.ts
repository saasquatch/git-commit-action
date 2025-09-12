/**
 *
 * Originally based on https://gist.github.com/quilicicf/41e241768ab8eeec1529869777e996f0
 *
 */
declare global {
  var packageVersion: string;
}

import { getInput, getMultilineInput, setFailed } from "@actions/core";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { parseAsync, z } from "zod/v4-mini";
import type { $ZodType, output as SchemaOutput } from "zod/v4/core";

const MODES = { FILE: "100644", FOLDER: "040000" };
const TYPE = { BLOB: "blob", TREE: "tree", COMMIT: "commit" };

const branchRefSchema = z.object({
  object: z.object({
    sha: z.string(),
  }),
});

const currentCommitSchema = z.object({
  tree: z.object({
    sha: z.string(),
  }),
});

const newShaSchema = z.object({
  sha: z.string(),
});

async function parseRes<T extends $ZodType>(
  res: Response,
  url: string,
  schema: T,
): Promise<SchemaOutput<T>> {
  return new Promise((resolve, reject) => {
    if (res.status >= 200 && res.status < 300) {
      res
        .json()
        .then((body) => parseAsync(schema, body))
        .then((parsed) => resolve(parsed));
    } else {
      res
        .text()
        .then((text) => {
          reject(
            `Request to ${url} failed: invalid status ${res.status}: ${text}`,
          );
        })
        .catch(() => {
          reject(
            `Request to ${url} failed: invalid status ${res.status} (text parsing failed)`,
          );
        });
    }
  });
}

async function main(): Promise<void> {
  const GITHUB_TOKEN = process.env["GITHUB_TOKEN"];
  if (!GITHUB_TOKEN) {
    setFailed(`Missing required environment variable "GITHUB_TOKEN"`);
    return;
  }

  const repo = getInput("repository");
  const branch = getInput("branch");
  const message = getInput("message");
  const longMessage = getInput("long-message");
  const tag = getInput("tag");
  const tagMessage = getInput("tag-message");
  const workingDir = getInput("working-directory");
  const filesInput = getMultilineInput("files");

  // we'll check this first so that we don't create all the trees & commits
  // and stuff before erroring out at the tag step
  if (tag && !tagMessage) {
    setFailed("`tag-message` is required if `tag` is specified");
    return;
  }

  if (filesInput.length === 0) {
    setFailed("Must specifiy at least one file to stage & commit");
    return;
  }

  const [repoOwner, repoName] = repo.split("/");

  if (!repoOwner || !repoName) {
    setFailed(`Failed to extract repo owner and name from string "${repo}"`);
    return;
  }

  const files = workingDir
    ? filesInput.map((file) => join(workingDir, file))
    : filesInput;

  const baseUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/git`;
  const commitsUrl = `${baseUrl}/commits`;
  const treeUrl = `${baseUrl}/trees`;
  const refUrl = `${baseUrl}/refs/heads/${branch}`;
  const tagObjectUrl = `${baseUrl}/tags`;
  const tagRefUrl = `${baseUrl}/refs`;

  const getHeaders = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": `@saasquatch/git-commit-action@${packageVersion}`,
  };

  const postHeaders = {
    ...getHeaders,
    "Content-Type": "application/json",
  };

  // Get the sha of the last commit on selected branch
  const {
    object: { sha: currentCommitSha },
  } = await fetch(refUrl, { headers: getHeaders }).then((res) =>
    parseRes(res, refUrl, branchRefSchema),
  );

  // Get the sha of the root tree on the commit retrieved previously
  const currentCommitUrl = `${commitsUrl}/${currentCommitSha}`;

  const {
    tree: { sha: treeSha },
  } = await fetch(currentCommitUrl, { headers: getHeaders }).then((res) =>
    parseRes(res, currentCommitUrl, currentCommitSchema),
  );

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
  const { sha: newTreeSha } = await fetch(treeUrl, {
    method: "POST",
    headers: postHeaders,
    body: JSON.stringify({ base_tree: treeSha, tree: treeInput }),
  }).then((res) => parseRes(res, treeUrl, newShaSchema));

  // Create a commit that uses the tree created above
  const { sha: newCommitSha } = await fetch(commitsUrl, {
    method: "POST",
    headers: postHeaders,
    body: JSON.stringify({
      message: longMessage ? `${message}\n\n${longMessage}` : message,
      tree: newTreeSha,
      parents: [currentCommitSha],
    }),
  }).then((res) => parseRes(res, commitsUrl, newShaSchema));

  // Make the selected branch point to the created commit
  await fetch(refUrl, {
    method: "POST",
    headers: postHeaders,
    body: JSON.stringify({ sha: newCommitSha }),
  }).then((res) => parseRes(res, refUrl, z.any()));

  if (tag) {
    // Create a new tag object pointing to the commit we just made
    // and with the specified tag + message
    const { sha: newTagSha } = await fetch(tagObjectUrl, {
      method: "POST",
      headers: postHeaders,
      body: JSON.stringify({
        tag,
        message: tagMessage,
        object: newCommitSha,
        type: TYPE.COMMIT,
      }),
    }).then((res) => parseRes(res, tagObjectUrl, newShaSchema));

    // Create a new tag ref pointing to the tag object we just made
    await fetch(tagRefUrl, {
      method: "POST",
      headers: postHeaders,
      body: JSON.stringify({
        ref: `refs/tags/${tag}`,
        sha: newTagSha,
      }),
    }).then((res) => parseRes(res, tagRefUrl, z.any()));
  }
}

main().catch((e) => {
  const formattedError = JSON.stringify(
    { e, eStr: `${e}`, eJson: JSON.stringify(e) },
    null,
    2,
  );

  setFailed(`Action failed: ${formattedError}`);
});
