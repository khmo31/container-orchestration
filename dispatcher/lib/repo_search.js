/**
 * repo_search.js — GitHub 저장소 검색 모듈
 *
 * GitHub API를 통해 관련 저장소를 검색.
 * 에스컬레이션 레이어에서 사용되어 사용자에게 적절한 repo를 추천.
 */

const https = require('https');
const http = require('http');

class RepoSearch {
  constructor(options = {}) {
    this.token = options.token || process.env.GITHUB_PAT || null;
    this.maxResults = options.maxResults || 5;
    this.baseUrl = 'api.github.com';
  }

  /**
   * GitHub 저장소 검색 (q 파라미터 기반)
   * @param {string} query - 검색어
   * @param {Object} options - 검색 옵션 { language, sort, maxResults }
   * @returns {Promise<Object>} { success, repos[], error }
   */
  async search(query, options = {}) {
    const lang = options.language || '';
    const sort = options.sort || 'stars';
    const maxResults = options.maxResults || this.maxResults;

    // 검색어 조립
    let q = encodeURIComponent(query);
    if (lang) q += `+language:${encodeURIComponent(lang)}`;

    const path = `/search/repositories?q=${q}&sort=${sort}&per_page=${maxResults}&page=1`;

    try {
      const data = await this._githubRequest(path);
      const repos = data.items.map(item => ({
        name: item.full_name,
        description: item.description || 'No description',
        url: item.html_url,
        stars: item.stargazers_count,
        language: item.language || 'Unknown',
        topics: item.topics || [],
        updated_at: item.updated_at
      }));

      return {
        success: true,
        repos,
        total_count: data.total_count,
        query
      };
    } catch (e) {
      return { success: false, repos: [], error: e.message, query };
    }
  }

  /**
   * 인텐트 기반 저장소 검색
   * @param {string} intent - 분류된 인텐트 (bug, feature, trading 등)
   * @param {string} context - 추가 컨텍스트
   * @returns {Promise<Object>}
   */
  async searchByIntent(intent, context = '') {
    const intentQueries = {
      bug: ['bug fix', 'error handling', 'debugging tool'],
      feature: ['feature request', 'feature implementation', 'new feature template'],
      review: ['code review tool', 'code audit', 'static analysis'],
      analysis: ['data analysis', 'pdf processing', 'document analysis'],
      trading: ['trading bot', 'stock trading', 'quantitative trading', 'algorithmic trading'],
      record: ['note taking', 'knowledge base', 'second brain'],
      strategy: ['strategy planning', 'decision framework'],
      config: ['configuration management', 'env setup'],
      planning: ['task planning', 'workflow orchestration'],
      unknown: ['ai agent', 'orchestration', 'automation']
    };

    const queries = intentQueries[intent] || intentQueries.unknown;
    const results = [];

    for (const q of queries) {
      if (results.length >= this.maxResults) break;
      const searchContext = context ? `${q} ${context.substring(0, 30)}` : q;
      const result = await this.search(searchContext);
      if (result.success && result.repos.length > 0) {
        for (const repo of result.repos) {
          if (!results.some(r => r.name === repo.name)) {
            results.push(repo);
          }
        }
      }
    }

    return {
      success: results.length > 0,
      repos: results.slice(0, this.maxResults),
      intent
    };
  }

  /**
   * GitHub API 요청
   */
  _githubRequest(path) {
    return new Promise((resolve, reject) => {
      const headers = {
        'User-Agent': 'Claw-Dispatcher/1.0',
        'Accept': 'application/vnd.github.v3+json'
      };

      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      const options = {
        hostname: this.baseUrl,
        path,
        method: 'GET',
        headers,
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 403) {
            // Rate limit - return empty gracefully
            return reject(new Error('GitHub API rate limit exceeded'));
          }
          if (res.statusCode === 401) {
            return reject(new Error('GitHub API authentication failed'));
          }
          if (res.statusCode >= 400) {
            return reject(new Error(`GitHub API error ${res.statusCode}: ${body.substring(0, 200)}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Invalid GitHub API response: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('GitHub API timeout'));
      });

      req.end();
    });
  }
}

module.exports = RepoSearch;
