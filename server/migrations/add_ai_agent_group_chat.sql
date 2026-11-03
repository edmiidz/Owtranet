-- AI agents in group chat channels: tagging @handle in a channel
-- message (e.g. #engineering) brings the agent in, same as forum posts/DMs.
-- Apply to EACH instance DB that already has add_ai_agents.sql + add_ai_agent_dms.sql.
-- ai_agent_replies gains a 'group_message' source (source_id = the group_messages
-- row that tagged the agent, post_id NULL) and records the reply it posted.
-- group_id is set at insert time (not joined through source_id -> group_messages)
-- so the per-channel rate limit stays correct even if the tagging message is
-- later deleted, and so the lookup can use an index instead of a correlated
-- subquery against group_messages.

ALTER TABLE `ai_agent_replies`
  MODIFY COLUMN `source_type` enum('post','comment','direct_message','group_message') NOT NULL,
  ADD COLUMN `reply_group_message_id` int DEFAULT NULL AFTER `reply_message_id`,
  ADD COLUMN `group_id` int DEFAULT NULL AFTER `post_id`,
  ADD KEY `idx_aar_group` (`group_id`);
