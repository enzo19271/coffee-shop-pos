// GitHub API helper functions
const GITHUB_API = 'https://api.github.com';

async function getGitHubFile(path) {
  try {
    // Cache-busting param prevents GitHub's CDN from serving a stale cached
    // version right after a write (updateGitHubFile).
    const cacheBuster = Date.now();
    const branch = process.env.GITHUB_BRANCH || 'main';

    const response = await fetch(
      `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${path}?ref=${branch}&_=${cacheBuster}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3.raw',
          'Cache-Control': 'no-cache'
        },
        cache: 'no-store'
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    console.error(`Error fetching ${path}:`, error);
    throw error;
  }
}

async function updateGitHubFile(path, content, message) {
  try {
    // Get current file SHA for update
    const shaResponse = await fetch(
      `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${path}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json'
        }
      }
    );

    let sha = '';
    if (shaResponse.ok) {
      const data = await shaResponse.json();
      sha = data.sha;
    }

    const updateResponse = await fetch(
      `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: message || `Update ${path}`,
          content: Buffer.from(content).toString('base64'),
          sha: sha || undefined,
          branch: process.env.GITHUB_BRANCH || 'main'
        })
      }
    );

    if (!updateResponse.ok) {
      throw new Error(`Failed to update file: ${updateResponse.status}`);
    }

    return await updateResponse.json();
  } catch (error) {
    console.error(`Error updating ${path}:`, error);
    throw error;
  }
}

export { getGitHubFile, updateGitHubFile };
