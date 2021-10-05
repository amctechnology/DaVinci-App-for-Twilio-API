const twilio = require('twilio');
const readline = require('readline-sync');
let chatSid;
let callbackUrl;

function getAccountInfo() {
  const accountSid = readline.question('What is your account sid?\n');
  const authToken = readline.question(`What is your auth token?\n`);

  console.log(`AccountSid: ${accountSid}\nAuthToken: ${authToken}`);
  try {
    return new twilio(accountSid, authToken);
  } catch (error) {
    console.log(`Failed to authenticate with twilio:\n${error}`);
    process.exit(1);
  }
}

/**
 * Task Router Setup
 */
async function createTasks(client, workspaceSid) {
  try {
    const activity = await client.taskrouter
      .workspaces(workspaceSid)
      .activities.create({ available: false, friendlyName: 'ACW' });
    console.log(`Creating ACW: ${activity.sid}`);
  } catch (error) {
    console.log(`Failed to create tasks:\n${error}`);
    process.exit(1);
  }
}
async function createWorkspace(client) {
  if (callbackUrl === undefined) {
    callbackUrl = readline.question(`What is your twilio callback url?\n`);
  }
  try {
    const workspace = await client.taskrouter.workspaces.create({
      eventCallbackUrl: `${callbackUrl}/taskRouterWebhook`,
      eventsFilter: 'task.canceled,task.completed,task.wrapup',
      template: `FIFO`,
      friendlyName: `generated-workspace`
    });
    console.log(`Creating Workspace: ${workspace.sid}`);
    await createTasks(client, workspace.sid);
  } catch (error) {
    console.log(`Failed to create a workspace:\n${error}`);
    process.exit(1);
  }
}
async function setupTaskRouter(client) {
  try {
    const workspaceString = readline.question(
      `Do you have a workspace already? Y/n?\n`
    );
    if (
      workspaceString.toLowerCase() === 'y' ||
      workspaceString.toLowerCase() === 'yes'
    ) {
      // using prexisting workspace
      const workspaceSid = readline.question(`What is your workspace sid?\n`);
      await createTasks(client, workspaceSid);
    } else if (
      workspaceString.toLowerCase() === 'n' ||
      workspaceString.toLowerCase() === 'no'
    ) {
      // generating new workspace
      await createWorkspace(client);
    }
  } catch (error) {
    console.log(`Failed task router setup for TwilioApiApp: ${error}`);
    process.exit(1);
  }
}
async function taskRouter(client) {
  const taskRouterString = readline.question(
    `Have you setup the task router yet? Y/n\n`
  );

  if (
    taskRouterString.toLowerCase() === 'n' ||
    taskRouterString.toLowerCase() === 'no'
  ) {
    await setupTaskRouter(client);
  }
}

/**
 * Chat Setup
 */
async function setupChat(client) {
  if (callbackUrl === undefined) {
    callbackUrl = readline.question(`What is your twilio callback url?\n`);
  }
  const chatService = await client.chat.services.create({
    friendlyName: 'generated-chat',
    postWebhookUrl: `${callbackUrl}/outboundMessage`
  });
  console.log(`Created Chat: ${chatService.sid}`);
  chatSid = chatService.sid;
}

async function chat(client) {
  const chatString = readline.question(`Have you setup chat yet? Y/n\n`);
  if (chatString.toLowerCase() === 'n' || chatString.toLowerCase() === 'no') {
    await setupChat(client);
  }
}

/**
 * Proxy Setup
 */
async function addPhoneNumbers(client, serviceSid) {
  console.log(`Setting up the proxy.`);
  const phoneOneSid = readline.question(
    `What is the sid for the first phone number?\n`
  );
  const phoneTwoSid = readline.question(
    `What is the sid for the second phone number?\n`
  );
  try {
    client.proxy
      .services(serviceSid)
      .phoneNumbers.create({ sid: phoneOneSid })
      .then(function (phoneNumber) {
        console.log(`Added ${phoneNumber.sid} to proxy`);
      });
    client.proxy
      .services(serviceSid)
      .phoneNumbers.create({ sid: phoneTwoSid })
      .then((phoneNumber) => console.log(`Added ${phoneNumber.sid} to proxy`));
  } catch (error) {
    console.log(`Failed to add phone numbers:\n${error}`);
  }
}

async function setupProxy(client) {
  if (chatSid === undefined) {
    chatSid = readline.question(`What is your chat sid?\n`);
  }

  try {
    client.proxy.services
      .create({ uniqueName: 'generated-proxy', chatInstanceSid: chatSid })
      .then(function (service) {
        console.log(service.sid);
        addPhoneNumbers(client, service.sid);
      });
  } catch (error) {
    console.log(`Failed proxy setup for TwilioApiApp:/n${error}`);
  }
}

async function proxy(client) {
  const proxyString = readline.question(`Have you setup the proxy yet? Y/n\n`);
  if (
    proxyString.toLowerCase() === 'y' ||
    proxyString.toLowerCase() === 'yes'
  ) {
    return;
  }
  const phoneNumberString = readline.question(
    `Do you have two twilio phone numbers? Y/n\n`
  );
  if (
    (proxyString.toLowerCase() === 'n' || proxyString.toLowerCase() === 'no') &&
    (phoneNumberString.toLowerCase() === 'y' ||
      phoneNumberString.toLowerCase() === 'yes')
  ) {
    console.log(`Setting up the proxy`);
    setupProxy(client);
  } else if (
    phoneNumberString.toLowerCase() === 'n' ||
    phoneNumberString.toLowerCase() === 'no'
  ) {
    console.log(
      `Reference the documentation on how to get two twilio numbers for your account.`
    );
  }
}

async function setup(client) {
  await taskRouter(client);
  await chat(client);
  await proxy(client);
}

/**
 * Start of the script
 */
const accountInfo = getAccountInfo(); // Gets account information
setup(accountInfo);
