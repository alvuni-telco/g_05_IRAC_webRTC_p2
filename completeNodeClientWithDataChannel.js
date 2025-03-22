'use strict';

// Función de limpieza antes de cerrar la ventana
window.onbeforeunload = function(e){
  hangup();
}

// Variables para el canal de datos
var sendChannel, receiveChannel;
var sendButton = document.getElementById("sendButton");
var sendInput = document.getElementById("dataChannelSend");
var messagesDiv = document.getElementById("messages");

// Elementos de video HTML5
var localVideo = document.getElementById("localVideo");
var remoteVideo = document.getElementById("remoteVideo");

// Asigna la acción al botón "Enviar"
sendButton.onclick = sendData;

// Flags para el estado de la conexión
var isChannelReady = false;
var isInitiator = false;
var isStarted = false;

// Variables WebRTC
var localStream;
var remoteStream;
var pc;

// Configuración de STUN y restricciones
var pc_config = {
  'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]
};
var pc_constraints = {
  'optional': [ {'DtlsSrtpKeyAgreement': true} ]
};
var sdpConstraints = {};

function trace(text) {
  if (text[text.length - 1] == '\n') {
    text = text.substring(0, text.length - 1);
  }
  console.log((performance.now() / 1000).toFixed(3) + ": " + text);
}

// Solicita el nombre de la sala
var room = prompt('Enter room name:');
var urlServer = location.origin;
console.log("socket.io client connecting to server ", urlServer );
// Conecta con el servidor de señalización
var socket = io.connect(urlServer);

if (room !== '') {
  console.log('Create or join room', room);
  socket.emit('create or join', room);
}

var constraints = {video: true, audio: true};

// Obtención del stream del usuario
function handleUserMedia(stream) {
  localStream = stream;
  localVideo.srcObject = stream;
  console.log('Adding local stream.');
  sendMessage('got user media');
}
function handleUserMediaError(error){
  console.log('navigator.getUserMedia error: ', error);
}

// Eventos del socket
socket.on('created', function (room){
  console.log('Created room ' + room);
  isInitiator = true;
  navigator.mediaDevices.getUserMedia(constraints).then(handleUserMedia).catch(handleUserMediaError);
  console.log('Getting user media with constraints', constraints);
  checkAndStart();
});

socket.on('full', function (room){
  console.log('Room ' + room + ' is full');
});

socket.on('join', function (room){
  console.log('Another peer made a request to join room ' + room);
  console.log('This peer is the initiator of room ' + room + '!');
  isChannelReady = true;
});

socket.on('joined', function (room){
  console.log('This peer has joined room ' + room);
  isChannelReady = true;
  navigator.mediaDevices.getUserMedia(constraints).then(handleUserMedia).catch(handleUserMediaError);
  console.log('Getting user media with constraints', constraints);
});

socket.on('log', function (array){
  console.log.apply(console, array);
});

socket.on('message', function (message){
  console.log('Received message:', message);
  if (message.message === 'got user media') {
    checkAndStart();
  } else if (message.message.type === 'offer') {
    if (!isInitiator && !isStarted) {
      checkAndStart();
    }
    pc.setRemoteDescription(new RTCSessionDescription(message.message));
    doAnswer();
  } else if (message.message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message.message));
  } else if (message.message.type === 'candidate' && isStarted) {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.message.label,
      candidate: message.message.candidate
    });
    pc.addIceCandidate(candidate);
  } else if (message.message === 'bye' && isStarted) {
    handleRemoteHangup();
  }
});

function sendMessage(message){
  console.log('Sending message: ', message);
  socket.emit('message', {
    channel: room,
    message: message
  });
}

function checkAndStart() {
  if (!isStarted && typeof localStream != 'undefined' && isChannelReady) {
    createPeerConnection();
    isStarted = true;
    if (isInitiator) {
      doCall();
    }
  }
}

function createPeerConnection() {
  try {
    pc = new RTCPeerConnection(pc_config, pc_constraints);
    console.log("Adding local stream to RTCPeerConnection. Initiator: " + isInitiator);
    pc.addStream(localStream);
    pc.onicecandidate = handleIceCandidate;
    console.log('Created RTCPeerConnection with config: ' + JSON.stringify(pc_config) +
      ' and constraints: ' + JSON.stringify(pc_constraints));
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }

  pc.ontrack = handleRemoteStreamAdded;
  pc.onremovestream = handleRemoteStreamRemoved;

  if (isInitiator) {
    try {
      // Crea canal de datos
      sendChannel = pc.createDataChannel("sendDataChannel", {reliable: true});
      trace('Created send data channel');
    } catch (e) {
      alert('Failed to create data channel.');
      trace('createDataChannel() failed with exception: ' + e.message);
    }
    sendChannel.onopen = handleSendChannelStateChange;
    sendChannel.onmessage = handleMessage;
    sendChannel.onclose = handleSendChannelStateChange;
  } else {
    pc.ondatachannel = gotReceiveChannel;
  }
}

function sendData() {
  var data = sendInput.value;
  if (!data.trim()) return; // No enviar mensajes vacíos

  addMessage("Tú: " + data, "sent");

  if (isInitiator) {
    sendChannel.send(data);
  } else {
    receiveChannel.send(data);
  }
  sendInput.value = ""; // Limpiar campo
}

function addMessage(text, type) {
  var messageElement = document.createElement("div");
  messageElement.textContent = text;
  messageElement.classList.add("message", type);
  messagesDiv.appendChild(messageElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function gotReceiveChannel(event) {
  trace('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.onmessage = handleMessage;
  receiveChannel.onopen = handleReceiveChannelStateChange;
  receiveChannel.onclose = handleReceiveChannelStateChange;
}

function handleMessage(event) {
  trace('Received message: ' + event.data);
  addMessage("Remoto: " + event.data, "received");
}

function handleSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  trace('Send channel state is: ' + readyState);
  if (readyState === "open") {
    sendInput.disabled = false;
    sendInput.focus();
    sendInput.placeholder = "";
    sendButton.disabled = false;
  } else {
    sendInput.disabled = true;
    sendButton.disabled = true;
  }
}

function handleReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  trace('Receive channel state is: ' + readyState);
  if (readyState === "open") {
    sendInput.disabled = false;
    sendInput.focus();
    sendInput.placeholder = "";
    sendButton.disabled = false;
  } else {
    sendInput.disabled = true;
    sendButton.disabled = true;
  }
}

function handleIceCandidate(event) {
  console.log('handleIceCandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    });
  } else {
    console.log('End of candidates.');
  }
}

function doCall() {
  console.log('Creating Offer...');
  pc.createOffer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}

function onSignalingError(error) {
  console.log('Failed to create signaling message: ' + error.name);
}

function doAnswer() {
  console.log('Sending answer to peer.');
  pc.createAnswer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}

function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  sendMessage(sessionDescription);
}

function handleRemoteStreamAdded(event) {
  console.log('Remote stream added.');
  remoteVideo.srcObject = event.streams[0];
  console.log('Remote stream attached.');
  remoteStream = event.stream;
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('bye');
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
}

function stop() {
  isStarted = false;
  if (sendChannel) sendChannel.close();
  if (receiveChannel) receiveChannel.close();
  if (pc) pc.close();
  pc = null;
  sendButton.disabled = true;
}
