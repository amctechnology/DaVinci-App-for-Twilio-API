exports.handler = function(context, event, callback) {
    try {
        console.log('EventType: ' + event.EventType);
	    const eventKeys = Object.keys(event);
	    console.log('event: ');
	    console.log(event);
	    const attributes = JSON.parse(event.TaskAttributes);
	    if(attributes.type === 'sms') {
	        if (event.hasOwnProperty('TaskAssignmentStatus') && event['TaskAssignmentStatus'] === 'completed') {
	            console.log('Removing sms channels');
	            const client = context.getTwilioClient();
	            client.proxy.services(context.PROXY_SERVICE)
                .sessions(attributes.proxySid)
                .remove()
                .then(() =>
                     client.chat.services(context.CHAT_SERVICE)
                    .channels(attributes.channelSid)
                    .remove()
                )
                .then(() => callback(null));
	        } else {
	            callback(null);
	        }
	    } else {
	        callback(null);
	    }
    } catch (error) {
        console.log('TaskRouterWebhook error: ' + error);
        callback(null, error);
    }
};
