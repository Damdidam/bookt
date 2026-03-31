/**
 * Email service — barrel re-export
 * All sub-modules are re-exported here so existing require('./services/email') keeps working.
 */
module.exports = {
  ...require('./email-utils'),
  ...require('./email-booking'),
  ...require('./email-modification'),
  ...require('./email-deposit'),
  ...require('./email-cancel'),
  ...require('./email-misc'),
};
