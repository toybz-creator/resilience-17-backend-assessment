/* eslint camelcase: ["error", { properties: "never" }] */
/* eslint prefer-destructuring: "off" */
const { PaymentMessages } = require('@app/messages');

const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'GHS'];

function isAlphaNumOrAllowed(ch) {
  const code = ch.charCodeAt(0);
  const isDigit = code >= 48 && code <= 57;
  const isUpper = code >= 65 && code <= 90;
  const isLower = code >= 97 && code <= 122;
  const isAllowed = ch === '-' || ch === '.' || ch === '@';
  return isDigit || isUpper || isLower || isAllowed;
}

function isPositiveIntegerString(str) {
  if (!str || typeof str !== 'string') return false;
  let i = 0;
  // no leading '+' or '-'
  if (str[0] === '-' || str[0] === '+') return false;
  for (i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  // must be > 0
  if (str.length === 0) return false;
  // disallow 0
  let allZero = true;
  for (i = 0; i < str.length; i += 1) {
    if (str[i] !== '0') {
      allZero = false;
      break;
    }
  }
  return !allZero;
}

function isValidDateYYYYMMDD(str) {
  if (!str || str.length !== 10) return false;
  // YYYY-MM-DD, positions 4 and 7 must be '-'
  if (str[4] !== '-' || str[7] !== '-') return false;
  // digits elsewhere
  const positions = [0, 1, 2, 3, 5, 6, 8, 9];
  for (let i = 0; i < positions.length; i += 1) {
    const p = positions[i];
    const code = str.charCodeAt(p);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function normalizeSpaces(text) {
  let out = '';
  let prevSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const isSpace = ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
    if (isSpace) {
      if (!prevSpace) {
        out += ' ';
        prevSpace = true;
      }
    } else {
      out += ch;
      prevSpace = false;
    }
  }
  return out.trim();
}

function findAccount(accounts, id) {
  for (let i = 0; i < accounts.length; i += 1) {
    if (accounts[i] && accounts[i].id === id) return accounts[i];
  }
  return null;
}

function buildErrorPayload(
  {
    type,
    amount,
    currency,
    debitAccountId,
    creditAccountId,
    executeBy,
    status_code: statusCode,
    status_reason: statusReason,
  },
  accounts
) {
  const payload = {
    type,
    amount,
    currency,
    debit_account: debitAccountId,
    credit_account: creditAccountId,
    execute_by: executeBy || null,
    status: 'failed',
    status_reason: statusReason,
    status_code: statusCode,
    accounts: [],
  };

  if (debitAccountId && creditAccountId) {
    const dAcc = findAccount(accounts, debitAccountId);
    const cAcc = findAccount(accounts, creditAccountId);
    if (dAcc) {
      payload.accounts.push({
        id: dAcc.id,
        currency: dAcc.currency.toUpperCase(),
        balance: dAcc.balance,
        balance_before: dAcc.balance,
      });
    }
    if (cAcc) {
      payload.accounts.push({
        id: cAcc.id,
        currency: cAcc.currency.toUpperCase(),
        balance: cAcc.balance,
        balance_before: cAcc.balance,
      });
    }
  }

  return payload;
}

function nowDateYMD() {
  return new Date().toISOString().slice(0, 10);
}

function compareDatesYMD(a, b) {
  // lexical compare works for YYYY-MM-DD
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Main service function
async function parseAndExecutePaymentInstruction(serviceData) {
  const { instruction, accounts } = serviceData || {};

  if (!instruction || typeof instruction !== 'string') {
    const payload = buildErrorPayload(
      {
        type: null,
        amount: null,
        currency: null,
        debitAccountId: null,
        creditAccountId: null,
        executeBy: null,
        status_code: 'SY03',
        status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
      },
      []
    );
    return { httpCode: 400, payload };
  }

  const normalized = normalizeSpaces(instruction);
  const parts = normalized.split(' ');
  if (parts.length < 4) {
    const payload = buildErrorPayload(
      {
        type: null,
        amount: null,
        currency: null,
        debitAccountId: null,
        creditAccountId: null,
        executeBy: null,
        status_code: 'SY03',
        status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
      },
      []
    );
    return { httpCode: 400, payload };
  }

  // parse type, amount, currency
  const typeToken = parts[0].toUpperCase();
  const amountToken = parts[1];
  const currencyToken = parts[2].toUpperCase();

  const isDebit = typeToken === 'DEBIT';
  const isCredit = typeToken === 'CREDIT';
  if (!isDebit && !isCredit) {
    const payload = buildErrorPayload(
      {
        type: null,
        amount: null,
        currency: null,
        debitAccountId: null,
        creditAccountId: null,
        executeBy: null,
        status_code: 'SY03',
        status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
      },
      []
    );
    return { httpCode: 400, payload };
  }

  const type = typeToken;
  const currency = currencyToken;

  if (!isPositiveIntegerString(amountToken)) {
    const payload = buildErrorPayload(
      {
        type,
        amount: null,
        currency,
        debitAccountId: null,
        creditAccountId: null,
        executeBy: null,
        status_code: 'AM01',
        status_reason: PaymentMessages.INVALID_AMOUNT,
      },
      accounts || []
    );
    return { httpCode: 400, payload };
  }
  const amount = parseInt(amountToken, 10);

  // currency support check
  let supported = false;
  for (let i = 0; i < SUPPORTED_CURRENCIES.length; i += 1) {
    if (SUPPORTED_CURRENCIES[i] === currency) {
      supported = true;
      break;
    }
  }
  if (!supported) {
    const payload = buildErrorPayload(
      {
        type,
        amount,
        currency,
        debitAccountId: null,
        creditAccountId: null,
        executeBy: null,
        status_code: 'CU02',
        status_reason: PaymentMessages.UNSUPPORTED_CURRENCY,
      },
      accounts || []
    );
    return { httpCode: 400, payload };
  }

  // parse keyword order and account ids
  let debitAccountId = null;
  let creditAccountId = null;
  let executeBy = null;

  function expectToken(idx, expected) {
    return parts[idx] && parts[idx].toUpperCase() === expected.toUpperCase();
  }

  // For DEBIT: DEBIT <amount> <currency> FROM ACCOUNT <debit_account> FOR CREDIT TO ACCOUNT <credit_account> [ON <date>]
  // For CREDIT: CREDIT <amount> <currency> TO ACCOUNT <credit_account> FOR DEBIT FROM ACCOUNT <debit_account> [ON <date>]
  if (isDebit) {
    if (!(expectToken(3, 'FROM') && expectToken(4, 'ACCOUNT'))) {
      const payload = buildErrorPayload(
        {
          type,
          amount,
          currency,
          debitAccountId,
          creditAccountId,
          executeBy,
          status_code: 'SY02',
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
        },
        accounts || []
      );
      return { httpCode: 400, payload };
    }
    // debit account id at 5
    debitAccountId = parts[5];
    if (!debitAccountId || ![...debitAccountId].every(isAlphaNumOrAllowed)) {
      const payload = buildErrorPayload(
        {
          type,
          amount,
          currency,
          debitAccountId,
          creditAccountId,
          executeBy,
          status_code: 'AC04',
          status_reason: PaymentMessages.INVALID_ACCOUNT_ID,
        },
        accounts || []
      );
      return { httpCode: 400, payload };
    }
    if (
      !(
        expectToken(6, 'FOR') &&
        expectToken(7, 'CREDIT') &&
        expectToken(8, 'TO') &&
        expectToken(9, 'ACCOUNT')
      )
    ) {
      const payload = buildErrorPayload(
        {
          type,
          amount,
          currency,
          debitAccountId,
          creditAccountId,
          executeBy,
          status_code: 'SY02',
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
        },
        accounts || []
      );
      return { httpCode: 400, payload };
    }
    creditAccountId = parts[10];
    if (!creditAccountId || ![...creditAccountId].every(isAlphaNumOrAllowed)) {
      const payload = buildErrorPayload(
        {
          type,
          amount,
          currency,
          debitAccountId,
          creditAccountId,
          executeBy,
          status_code: 'AC04',
          status_reason: PaymentMessages.INVALID_ACCOUNT_ID,
        },
        accounts || []
      );
      return { httpCode: 400, payload };
    }
    // optional ON date
    if (parts[11] && parts[11].toUpperCase() === 'ON') {
      executeBy = parts[12] || null;
    }
  } else if (isCredit) {
    if (!(expectToken(3, 'TO') && expectToken(4, 'ACCOUNT'))) {
      const payload = buildErrorPayload(
        {
          type,
          amount,
          currency,
          debitAccountId,
          creditAccountId,
          executeBy,
          status_code: 'SY02',
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
        },
        accounts || []
      );
      return { httpCode: 400, payload };
    }
    creditAccountId = parts[5];
    if (!creditAccountId || ![...creditAccountId].every(isAlphaNumOrAllowed)) {
      const payload = buildErrorPayload(
        {
          type,
          amount,
          currency,
          debitAccountId,
          creditAccountId,
          executeBy,
          status_code: 'AC04',
          status_reason: PaymentMessages.INVALID_ACCOUNT_ID,
        },
        accounts || []
      );
      return { httpCode: 400, payload };
    }
    if (
      !(
        expectToken(6, 'FOR') &&
        expectToken(7, 'DEBIT') &&
        expectToken(8, 'FROM') &&
        expectToken(9, 'ACCOUNT')
      )
    ) {
      const payload = buildErrorPayload(
        {
          type,
          amount,
          currency,
          debitAccountId,
          creditAccountId,
          executeBy,
          status_code: 'SY02',
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
        },
        accounts || []
      );
      return { httpCode: 400, payload };
    }
    debitAccountId = parts[10];
    if (!debitAccountId || ![...debitAccountId].every(isAlphaNumOrAllowed)) {
      const payload = buildErrorPayload(
        {
          type,
          amount,
          currency,
          debitAccountId,
          creditAccountId,
          executeBy,
          status_code: 'AC04',
          status_reason: PaymentMessages.INVALID_ACCOUNT_ID,
        },
        accounts || []
      );
      return { httpCode: 400, payload };
    }
    if (parts[11] && parts[11].toUpperCase() === 'ON') {
      executeBy = parts[12] || null;
    }
  }

  // validate date format if provided
  if (executeBy) {
    if (!isValidDateYYYYMMDD(executeBy)) {
      const payload = buildErrorPayload(
        {
          type,
          amount,
          currency,
          debitAccountId,
          creditAccountId,
          executeBy,
          status_code: 'DT01',
          status_reason: PaymentMessages.INVALID_DATE_FORMAT,
        },
        accounts || []
      );
      return { httpCode: 400, payload };
    }
  }

  // business validations
  const debitAccount = findAccount(accounts || [], debitAccountId);
  const creditAccount = findAccount(accounts || [], creditAccountId);
  if (!debitAccount || !creditAccount) {
    const payload = buildErrorPayload(
      {
        type,
        amount,
        currency,
        debitAccountId,
        creditAccountId,
        executeBy,
        status_code: 'AC03',
        status_reason: PaymentMessages.ACCOUNT_NOT_FOUND,
      },
      accounts || []
    );
    return { httpCode: 400, payload };
  }
  if (debitAccountId === creditAccountId) {
    const payload = buildErrorPayload(
      {
        type,
        amount,
        currency,
        debitAccountId,
        creditAccountId,
        executeBy,
        status_code: 'AC02',
        status_reason: PaymentMessages.SAME_ACCOUNT_ERROR,
      },
      accounts || []
    );
    return { httpCode: 400, payload };
  }
  const debitCurrency = (debitAccount.currency || '').toUpperCase();
  const creditCurrency = (creditAccount.currency || '').toUpperCase();
  if (debitCurrency !== currency || creditCurrency !== currency) {
    const payload = buildErrorPayload(
      {
        type,
        amount,
        currency,
        debitAccountId,
        creditAccountId,
        executeBy,
        status_code: 'CU01',
        status_reason: PaymentMessages.CURRENCY_MISMATCH,
      },
      accounts || []
    );
    return { httpCode: 400, payload };
  }

  if (debitAccount.balance == null || debitAccount.balance < amount) {
    const payload = buildErrorPayload(
      {
        type,
        amount,
        currency,
        debitAccountId,
        creditAccountId,
        executeBy,
        status_code: 'AC01',
        status_reason: PaymentMessages.INSUFFICIENT_FUNDS,
      },
      accounts || []
    );
    return { httpCode: 400, payload };
  }

  const today = nowDateYMD();
  const isImmediate = !executeBy || compareDatesYMD(executeBy, today) <= 0;

  const debitBefore = debitAccount.balance;
  const creditBefore = creditAccount.balance;
  let debitBalance = debitBefore;
  let creditBalance = creditBefore;

  let status = 'pending';
  let statusCode = 'AP02';
  let statusReason = PaymentMessages.TRANSACTION_PENDING;
  if (isImmediate) {
    debitBalance = debitBefore - amount;
    creditBalance = creditBefore + amount;
    status = 'successful';
    statusCode = 'AP00';
    statusReason = PaymentMessages.TRANSACTION_SUCCESSFUL;
  }

  const accountsOutput = [
    {
      id: debitAccount.id,
      currency: debitCurrency,
      balance: debitBalance,
      balance_before: debitBefore,
    },
    {
      id: creditAccount.id,
      currency: creditCurrency,
      balance: creditBalance,
      balance_before: creditBefore,
    },
  ];

  const payload = {
    type,
    amount,
    currency,
    debit_account: debitAccountId,
    credit_account: creditAccountId,
    execute_by: executeBy || null,
    status,
    status_reason: statusReason,
    status_code: statusCode,
    accounts: accountsOutput,
  };

  return { httpCode: 200, payload };
}

module.exports = { parseAndExecutePaymentInstruction };
