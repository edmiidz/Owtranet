/**
 * Example instance plugin — copy into $INSTANCE_DIR/plugins/ to try it.
 *
 *   curl -H "Authorization: Bearer <JWT>" https://intranet.example.com/api/plugins/hello
 */
module.exports = {
  name: 'hello',
  register({ router, auth, config, log }) {
    router.get('/api/plugins/hello', auth.authenticateToken, (req, res) => {
      res.json({ message: `Hello from a ${config.COMPANY_NAME} plugin`, userId: req.user.userId });
    });
    log.info('GET /api/plugins/hello registered');
  }
};
