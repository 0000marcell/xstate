const script = document.createElement('script');

const possibleMessageTypesFromInjectedScript = [
  'retrievingInitialServices',
  'registerService',
  'stateUpdate'
]


script.text = `
(() => {
  const sendMessage = (data = {}) => {
    window.postMessage({
      source: 'xstate-devtools',
      data: data
    }, '*');

  };

  let services = {};

  window.addEventListener('message', (event) => {
    // Only accept messages from same frame
          
    if (event.source !== window) {
      return;
    }
  
    const message = event.data;
  
    // Only accept messages of correct format (our messages)
    if (
      typeof message !== 'object' ||
      message === null
    ) {
      return;
    }
  
    if (message.source === 'xstate-devtools'
    && message.data
    && message.data.type === 'getCurrentServices'
    ) {
      console.log('injected sending to content: services:', services)
      sendMessage({
        type: 'retrievingInitialServices',
        services: JSON.stringify(services)
      })
    }
  });

  Object.defineProperty(window, '__XSTATE__', {
    value: {
      services: services,
      register: (service) => {

        services[service.sessionId] = {
          state: service.state,
          machine: service.machine.config,
          eventsLog: [],
          statesAfterEvent: []
        };

        console.log('injected sending data to content: service', service)

        sendMessage({
          type: 'registerService',
          machine: JSON.stringify(service.machine.config),
          state: JSON.stringify(service.state),
          sessionId: service.sessionId
        })

        service.subscribe((state, ...args) => { //TODO: switch to service.onEvent instead of service.subscribe
          const eventData = {
            event: state.event,
            time: Date.now()
          }

          services[service.sessionId].state = state;
          services[service.sessionId].eventsLog.push({ eventData: eventData })
          services[service.sessionId].statesAfterEvent.push(state)

          sendMessage({
            type: 'stateUpdate',
            state: JSON.stringify(state),
            eventData: JSON.stringify(eventData),
            sessionId: service.sessionId
          })
        })
      }
    },
  });
})();
`;
script.onload = () => {
  script.parentNode.removeChild(script);
};
(document.head || document.documentElement).appendChild(script);

/*
 * agent -> **content-script.js** -> background.js -> dev tools
 */
window.addEventListener('message', (event) => {
  // Only accept messages from same frame
  if (event.source !== window) {
    return;
  }

  const message = event.data;

  // Only accept messages of correct format (our messages)
  if (
    typeof message !== 'object' ||
    message === null
  ) {
    return;
  }

  console.log('content script received event:', event)

  if (message.source === 'xstate-devtools'
    && message.data
    && possibleMessageTypesFromInjectedScript.includes(message.data.type)
    ) {
    console.log('sending message from content to background: event:', event)
    if (message.data.type === 'stateUpdate') {
      console.log('injected->content diff:', Date.now() - JSON.parse(message.data.eventData).time)
    }
    chrome.runtime.sendMessage(message);
  }
  
});
/*
 * agent <- **content-script.js** <- background.js <- dev tools
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message
    && message.source === 'xstate-devtools'
    && message.data
    && message.data.type === 'getCurrentServices'
    ) {
    console.log('content sending getCurrentServices to injected')
    window.postMessage(message, '*');  
  }
});
