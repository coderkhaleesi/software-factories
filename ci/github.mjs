/** The GitHub REST calls the gate and the readiness check make, with one fetch wrapper. Any failure throws. */

async function request(method, url, token, body) {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "software-factories", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

export const githubJson = (url, token) => request("GET", url, token);

export async function listAll(url, token) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`, token);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

const api = "https://api.github.com/repos";
export const listIssueComments = (repo, issue, token) => listAll(`${api}/${repo}/issues/${issue}/comments`, token);
export const listOpenPulls = (repo, token) => listAll(`${api}/${repo}/pulls?state=open`, token);
export const listOpenPullsByHead = (repo, branch, token) => listAll(`${api}/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${branch}`, token);
export const listPullCommits = (repo, number, token) => listAll(`${api}/${repo}/pulls/${number}/commits`, token);
export const listPullReviews = (repo, number, token) => listAll(`${api}/${repo}/pulls/${number}/reviews`, token);
export const getPull = (repo, number, token) => githubJson(`${api}/${repo}/pulls/${number}`, token);
export const getIssue = (repo, issue, token) => githubJson(`${api}/${repo}/issues/${issue}`, token);
export const getPermission = (repo, login, token) => githubJson(`${api}/${repo}/collaborators/${login}/permission`, token);
export const postStatus = (repo, sha, status, token) => request("POST", `${api}/${repo}/statuses/${sha}`, token, status);
