const { createHandler } = require('@app-core/server');
const { parseAndExecutePaymentInstruction } = require('@app/services/payments/parse-instruction');

module.exports = createHandler({
  path: '/payment-instructions',
  method: 'post',
  middlewares: [],
  async handler(rc, helpers) {
    const { accounts, instruction } = rc.body || {};
    const { httpCode, payload } = await parseAndExecutePaymentInstruction({
      accounts: accounts || [],
      instruction,
    });
    return {
      status:
        httpCode === 200
          ? helpers.http_statuses.HTTP_200_OK
          : helpers.http_statuses.HTTP_400_BAD_REQUEST,
      data: payload,
    };
  },
});
