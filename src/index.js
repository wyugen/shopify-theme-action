const core = require("@actions/core");
const github = require("@actions/github");
const axios = require("axios").default;
const exec = require("@actions/exec");
const octokit = github.getOctokit(core.getInput("github-token"));
const commentIdentifier =
  "<!-- Comment by Shopify Theme Deploy Previews Action -->";

const parsePullRequestId = (githubRef) => {
  const result = /refs\/pull\/(\d+)\/merge/g.exec(githubRef);
  if (!result) throw new Error("Reference not found.");
  const [, pullRequestId] = result;
  return pullRequestId;
};

const createGitHubDeployment = async (url) => {
  const deployment = await octokit.repos.createDeployment({
    auto_merge: false,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    ref: github.context.ref,
    environment: "pull request",
  });
  await octokit.repos.createDeploymentStatus({
    state: "success",
    environment_url: url,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    deployment_id: deployment.data.id,
  });
};

const createGitHubComment = async (prID, message) => {
  await octokit.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: prID,
    body: message,
  });
};

const findIssueComment = async (prID) => {
  const listRes = await octokit.issues.listComments({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: prID,
  });
  const comments = listRes.data;
  for (const comment of comments) {
    if (comment.body.includes(commentIdentifier)) return comment.id;
  }
  return undefined;
};

const deletePreviousComment = async (prID) => {
  const commentID = await findIssueComment(prID);
  if (commentID) {
    await octokit.issues.deleteComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      comment_id: commentID,
    });
  }
};

const getThemeID = async (BASE_URL, prID) => {
  const allThemesResp = await axios.get(BASE_URL + "/themes.json", {
    headers: { "User-Agent": "Shopify Theme Action" },
  });
  const themes = allThemesResp.data["themes"];
  let themeID = 0;
  for (const theme of themes) {
    if (theme["name"] === `PR#${prID}`) {
      return theme["id"];
    }
  }
  return 0;
};

const main = async () => {
  const apiKey = core.getInput("SHOPIFY_API_KEY");
  const password = core.getInput("SHOPIFY_APP_PW");
  const storeURL = core.getInput("SHOPIFY_STORE");

  const prID = parsePullRequestId(process.env.GITHUB_REF);

  await exec.exec(
    "curl -s https://shopify.github.io/themekit/scripts/install.py | sudo python"
  );

  const BASE_URL = `https://${apiKey}:${password}@${storeURL}/admin/api/2020-07`;
  const themeID = await getThemeID(BASE_URL, prID);

  if (themeID === 0) {
    // Create a new theme
    await exec.exec(
      `theme new --password=${password} --store=${storeURL} --name='PR#${prID}'`
    );
    themeID = await getThemeID(BASE_URL, prID);
  } else {
    await exec.exec(
      `theme deploy --password=${password} --store=${storeURL} --themeid='${themeID}'`
    );
  }

  const URL = `http://${storeURL}/?preview_theme_id=${themeID}`;

  core.setOutput("deploy-url", URL);
  core.setOutput("theme-id", themeID);

  // creates a new GitHub deployment
  // await createGitHubDeployment(URL)

  // Delete previous comment
  await deletePreviousComment(prID);

  // Create new comment
  await createGitHubComment(
    prID,
    `${commentIdentifier}\n🚀 Deployed successfully to ${URL}`
  );
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
