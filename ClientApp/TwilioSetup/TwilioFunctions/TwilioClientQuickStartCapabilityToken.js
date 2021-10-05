exports.handler = function (context, event, callback) {
  const response = new Twilio.Response();

  // Add CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type': 'application/json'
  };

  // Set headers in response
  response.setHeaders(headers);

  response.setStatusCode(200);

  const clientCapability = require('twilio').jwt.ClientCapability;

  const identity = 'the_user_id';
  const capability = new clientCapability({
    accountSid: context.ACCOUNT_SID,
    authToken: context.AUTH_TOKEN
  });

  capability.addScope(new clientCapability.IncomingClientScope(identity));
  capability.addScope(
    new clientCapability.OutgoingClientScope({
      applicationSid: context.TWIML_APP_SID,
      clientName: identity
    })
  );

  // Include identity and token in a JSON response
  response.setBody({
    identity: identity,
    token: capability.toJwt()
  });

  callback(null, response);
};
