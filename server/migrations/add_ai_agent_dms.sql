-- Direct messages to AI agents: the agent answers a DM with a DM of its own.
-- Apply to EACH instance DB that already has add_ai_agents.sql.
-- ai_agent_replies gains a 'direct_message' source (source_id = the DM that was
-- answered, post_id NULL) and records the reply DM it posted.

ALTER TABLE `ai_agent_replies`
  MODIFY COLUMN `source_type` enum('post','comment','direct_message') NOT NULL,
  MODIFY COLUMN `post_id` int DEFAULT NULL,
  ADD COLUMN `reply_message_id` int DEFAULT NULL AFTER `reply_comment_id`;
