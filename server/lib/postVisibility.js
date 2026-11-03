/**
 * Shared post-visibility predicate.
 *
 * The intranet's post permission model (see GET /api/posts in server.js):
 *   - visibility = 'all_members' (or NULL)  → everyone
 *   - author (p.user_id = viewer)           → always
 *   - visibility = 'specific_members'       → only users granted in post_visibility
 *   - visibility = 'author_only'            → author only
 *
 * Every consumer (forum list, radio feed, mobile home, workers) must use this
 * so the rule can never drift between features. Admins get NO special read
 * access — that matches the existing forum behaviour.
 */

/**
 * Returns a SQL fragment (wrapped in parentheses) and the params it needs.
 * @param {string} alias  table alias used for posts in the outer query
 * @param {number} userId viewer id
 */
function visiblePostsWhere(alias = 'p', userId) {
  const sql = `(
    ${alias}.visibility = 'all_members' OR
    ${alias}.visibility IS NULL OR
    ${alias}.user_id = ? OR
    (${alias}.visibility = 'specific_members' AND ${alias}.id IN (
      SELECT pv.post_id FROM post_visibility pv WHERE pv.user_id = ?
    ))
  )`;
  return { sql, params: [userId, userId] };
}

/**
 * Imperative check for a single post row (already loaded).
 * @param {object} db mysql2/promise pool
 * @param {{id:number,user_id:number,visibility:string|null}} post
 * @param {number} userId
 */
async function canUserViewPost(db, post, userId) {
  if (!post) return false;
  if (!post.visibility || post.visibility === 'all_members') return true;
  if (post.user_id === userId) return true;
  if (post.visibility === 'specific_members') {
    const [rows] = await db.execute(
      'SELECT 1 FROM post_visibility WHERE post_id = ? AND user_id = ? LIMIT 1',
      [post.id, userId]
    );
    return rows.length > 0;
  }
  return false; // author_only and unknown values
}

module.exports = { visiblePostsWhere, canUserViewPost };
