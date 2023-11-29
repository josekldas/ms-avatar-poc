// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

var system_prompt = `Eres Luisa, una entrevistadora virtual inteligente desarrollada por Mobiik, una consultora especializada en implementaciones de inteligencia artificial en la nube. Tu tarea es entrevistar a José para el puesto de Analista de Llamadas. Durante la entrevista, recuerda lo siguiente:
- Evaluación: Determina la idoneidad de José para el puesto basándote en sus respuestas.
- Adaptabilidad: Modifica tus preguntas para mantener la conversación fluida y natural, enfocándote en una pregunta a la vez.
- Asistencia: Si José tiene dudas o preguntas adicionales, responde de manera informativa y empática.
- Personalización: Considera cuidadosamente las respuestas de José antes de formular la siguiente pregunta, personalizando la experiencia de la entrevista.
- Claridad: No asumas respuestas o información personal. Si necesitas aclaraciones, pregúntale directamente.
- Concisión y calidez: Mantén tus respuestas concisas, claras y humanas, fomentando una interacción amena.
- Agradecimiento: Al finalizar la entrevista, agradece a José por su tiempo y por compartir sus experiencias.
Recuerda, eres un representante de Mobiik y tu interacción debe reflejar los altos estándares de la empresa en cuanto a profesionalismo y habilidades en IA.
`

const TTSVoice = "en-US-JennyMultilingualNeural" // Update this value if you want to use a different voice

const CogSvcRegion = "eastus" // Fill your Azure cognitive services region here, e.g. westus2

const IceServerUrl = "turn:relay.communication.microsoft.com:3478" // Fill your ICE server URL here, e.g. turn:turn.azure.com:3478
let IceServerUsername
let IceServerCredential

// This is the only avatar which supports live streaming so far, please don't modify
const TalkingAvatarCharacter = "lisa"
const TalkingAvatarStyle = "casual-sitting"

supported_languages = ["en-US", "es-ES"] // The language detection engine supports a maximum of 4 languages

const BackgroundColor = '#FFFFFFFF'

let token

const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL("wss://{region}.tts.speech.microsoft.com/cognitiveservices/websocket/v1?enableTalkingAvatar=true".replace("{region}", CogSvcRegion)))

// Global objects
var speechSynthesizer
var peerConnection
var previousAnimationFrameTimestamp = 0

messages = [{ "role": "system", "content": system_prompt },{ "role": "assistant", "content": "Hola José, mi nombre es Luisa y seré tu entrevistadora virtual el día de hoy. Estamos buscando a alguien excepcional para la posición de Analista de Llamadas. Durante esta entrevista, exploraremos tus habilidades y experiencias para ver si encajas con lo que buscamos. Cuando estés listo para comenzar, presiona el micrófono y responderé todas tus dudas y te guiaré a través del proceso." } ];

function removeDocumentReferences(str) {
  // Regular expression to match [docX]
  var regex = /\[doc\d+\]/g;

  // Replace document references with an empty string
  var result = str.replace(regex, '');

  return result;
}

// Setup WebRTC
function setupWebRTC() {
  // Create WebRTC peer connection
  fetch("/api/getIceServerToken", {
    method: "POST"
  })
    .then(response => response.json())
    .then(response => { 
      IceServerUsername = response.username
      IceServerCredential = response.credential

      peerConnection = new RTCPeerConnection({
        iceServers: [{
          urls: [IceServerUrl],
          username: IceServerUsername,
          credential: IceServerCredential
        }]
      })
    
      // Fetch WebRTC video stream and mount it to an HTML video element
      peerConnection.ontrack = function (event) {
        console.log('peerconnection.ontrack', event)
        // Clean up existing video element if there is any
        remoteVideoDiv = document.getElementById('remoteVideo')
        for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
          if (remoteVideoDiv.childNodes[i].localName === event.track.kind) {
            remoteVideoDiv.removeChild(remoteVideoDiv.childNodes[i])
          }
        }
    
        const videoElement = document.createElement(event.track.kind)
        videoElement.id = event.track.kind
        videoElement.srcObject = event.streams[0]
        videoElement.autoplay = true
        videoElement.controls = false
        document.getElementById('remoteVideo').appendChild(videoElement)

        canvas = document.getElementById('canvas')
        remoteVideoDiv.hidden = true
        canvas.hidden = false

        videoElement.addEventListener('play', () => {
          remoteVideoDiv.style.width = videoElement.videoWidth / 2 + 'px'
          window.requestAnimationFrame(makeBackgroundTransparent)
      })
      }
    
      // Make necessary update to the web page when the connection state changes
      peerConnection.oniceconnectionstatechange = e => {
        console.log("WebRTC status: " + peerConnection.iceConnectionState)
    
        if (peerConnection.iceConnectionState === 'connected') {
          greeting()
          document.getElementById('loginOverlay').classList.add("hidden");
        }
    
        if (peerConnection.iceConnectionState === 'disconnected') {
        }
      }
    
      // Offer to receive 1 audio, and 1 video track
      peerConnection.addTransceiver('video', { direction: 'sendrecv' })
      peerConnection.addTransceiver('audio', { direction: 'sendrecv' })
    
      // Set local description
      peerConnection.createOffer().then(sdp => {
        peerConnection.setLocalDescription(sdp).then(() => { setTimeout(() => { connectToAvatarService() }, 1000) })
      }).catch(console.log)
    })  
}

async function generateText(prompt) {

  messages.push({
    role: 'user',
    content: prompt
  });

  let generatedText
  let products
  await fetch(`/api/message`, { method: 'POST', headers: { 'Content-Type': 'application/json'}, body: JSON.stringify(messages) })
  .then(response => response.json())
  .then(data => {
    generatedText = data["messages"][data["messages"].length - 1].content;
    messages = data["messages"];
    products = data["products"]
  });

  addToConversationHistory(generatedText, 'light');
  if(products.length > 0) {
    addProductToChatHistory(products[0]);
  }
  return generatedText;
}

// Connect to TTS Avatar API
function connectToAvatarService() {
  // Construct TTS Avatar service request
  let videoCropTopLeftX = 600
  let videoCropBottomRightX = 1320
  let backgroundColor = '#00FF00FF'

  console.log(peerConnection.localDescription)
  const clientRequest = {
    protocol: {
      name: "WebRTC",
      webrtcConfig: {
        clientDescription: btoa(JSON.stringify(peerConnection.localDescription)),
        iceServers: [{
          urls: [IceServerUrl],
          username: IceServerUsername,
          credential: IceServerCredential
        }]
      },
    },
    format: {
      codec: 'H264',
        resolution: {
            width: 1920,
            height: 1080
        },
        crop:{
            topLeft: {
                x: videoCropTopLeftX,
                y: 0
            },
            bottomRight: {
                x: videoCropBottomRightX,
                y: 1080
            }
        },
        bitrate: 2000000
    },
    talkingAvatar: {
      character: TalkingAvatarCharacter,
      style: TalkingAvatarStyle,
      background: {
          color: backgroundColor
      }
  }
  }

  // Callback function to handle the response from TTS Avatar API
  const complete_cb = function (result) {
    const sdp = result.properties.getProperty(SpeechSDK.PropertyId.TalkingAvatarService_WebRTC_SDP)
    if (sdp === undefined) {
      console.log("Failed to get remote SDP. The avatar instance is temporarily unavailable. Result ID: " + result.resultId)
      document.getElementById('startSession').disabled = false
    }

    peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(sdp)))).then(r => { })
  }

  const error_cb = function (result) {
    let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result)
    console.log(cancellationDetails)
    document.getElementById('startSession').disabled = false
  }

  // Call TTS Avatar API
  speechSynthesizer.setupTalkingAvatarAsync(JSON.stringify(clientRequest), complete_cb, error_cb)
}

window.startSession = () => {
  // Create the <i> element
  var iconElement = document.createElement("i");
  iconElement.className = "fa fa-spinner fa-spin";
  iconElement.id = "loadingIcon"
  var parentElement = document.getElementById("playVideo");
  parentElement.prepend(iconElement);

  speechSynthesisConfig.speechSynthesisVoiceName = TTSVoice
  document.getElementById('playVideo').className = "round-button-hide"

  fetch("/api/getSpeechToken", {
    method: "POST"
  })
    .then(response => response.text())
    .then(response => { 
      speechSynthesisConfig.authorizationToken = response;
      token = response
    })
    .then(() => {
      speechSynthesizer = new SpeechSDK.SpeechSynthesizer(speechSynthesisConfig, null)
      requestAnimationFrame(setupWebRTC)
    })

  
  // setupWebRTC()
}

async function greeting() {
  addToConversationHistory("Hola José, mi nombre es Luisa y seré tu entrevistadora virtual el día de hoy. Estamos buscando a alguien excepcional para la posición de Analista de Llamadas. Durante esta entrevista, exploraremos tus habilidades y experiencias para ver si encajas con lo que buscamos. Cuando estés listo para comenzar, presiona el micrófono y responderé todas tus dudas y te guiaré a través del proceso.", "light")

  let spokenText = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='Microsoft Server Speech Text to Speech Voice (en-US, JennyMultilingualNeural)'><lang xml:lang='es-ES'>Hola José, mi nombre es Luisa y seré tu entrevistadora virtual el día de hoy. Estamos buscando a alguien excepcional para la posición de Analista de Llamadas. Durante esta entrevista, exploraremos tus habilidades y experiencias para ver si encajas con lo que buscamos. Cuando estés listo para comenzar, presiona el micrófono y responderé todas tus dudas y te guiaré a través del proceso.</lang></voice></speak>";

  speechSynthesizer.speakSsmlAsync(spokenText, (result) => {
    if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
      console.log("Speech synthesized to speaker for text [ " + spokenText + " ]. Result ID: " + result.resultId)
    } else {
      console.log("Unable to speak text. Result ID: " + result.resultId)
      if (result.reason === SpeechSDK.ResultReason.Canceled) {
        let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result)
        console.log(cancellationDetails.reason)
        if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
          console.log(cancellationDetails.errorDetails)
        }
      }
    }
  })
}

window.speak = (text) => {
  async function speak(text) {
    addToConversationHistory(text, 'dark')

    fetch("/api/detectLanguage?text="+text, {
      method: "POST"
    })
      .then(response => response.text())
      .then(async language => {
        console.log(`Detected language: ${language}`);

        const generatedResult = await generateText(text);
        
        let spokenTextssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'><voice xml:lang='en-US' xml:gender='Female' name='en-US-JennyMultilingualNeural'><lang xml:lang="${language}">${generatedResult}</lang></voice></speak>`

        if (language == 'ar-AE') {
          spokenTextssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'><voice xml:lang='en-US' xml:gender='Female' name='ar-AE-FatimaNeural'><lang xml:lang="${language}">${generatedResult}</lang></voice></speak>`
        }
        let spokenText = generatedResult
        speechSynthesizer.speakSsmlAsync(spokenTextssml, (result) => {
          if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log("Speech synthesized to speaker for text [ " + spokenText + " ]. Result ID: " + result.resultId)
          } else {
            console.log("Unable to speak text. Result ID: " + result.resultId)
            if (result.reason === SpeechSDK.ResultReason.Canceled) {
              let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result)
              console.log(cancellationDetails.reason)
              if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
                console.log(cancellationDetails.errorDetails)
              }
            }
          }
        })
      })
      .catch(error => {
        console.error('Error:', error);
      });
  }
  speak(text);
}

window.stopSession = () => {
  speechSynthesizer.close()
}

window.startRecording = () => {
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, 'eastus');
  speechConfig.authorizationToken = token;
  speechConfig.SpeechServiceConnection_LanguageIdMode = "Continuous";
  var autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(supported_languages);
  // var autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(["en-US"]);

  document.getElementById('buttonIcon').className = "fas fa-stop"
  document.getElementById('startRecording').disabled = true

  recognizer = SpeechSDK.SpeechRecognizer.FromConfig(speechConfig, autoDetectSourceLanguageConfig);

  recognizer.recognized = function (s, e) {
    if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
      console.log('Recognized:', e.result.text);
      window.stopRecording();
      // TODO: append to conversation
      window.speak(e.result.text);
    }
  };

  recognizer.startContinuousRecognitionAsync();

  console.log('Recording started.');
}

window.stopRecording = () => {
  if (recognizer) {
    recognizer.stopContinuousRecognitionAsync(
      function () {
        recognizer.close();
        recognizer = undefined;
        document.getElementById('buttonIcon').className = "fas fa-microphone"
        document.getElementById('startRecording').disabled = false
        console.log('Recording stopped.');
      },
      function (err) {
        console.error('Error stopping recording:', err);
      }
    );
  }
}

window.submitText = () => {
  document.getElementById('spokenText').textContent = document.getElementById('textinput').currentValue
  document.getElementById('textinput').currentValue = ""
  window.speak(document.getElementById('textinput').currentValue);
}


function addToConversationHistory(item, historytype) {
  const list = document.getElementById('chathistory');
  const newItem = document.createElement('li');
  newItem.classList.add('message');
  newItem.classList.add(`message--${historytype}`);
  newItem.textContent = item;
  list.appendChild(newItem);
}

function addProductToChatHistory(product) {
  const list = document.getElementById('chathistory');
  const listItem = document.createElement('li');
  listItem.classList.add('product');
  listItem.innerHTML = `
    <fluent-card class="product-card">
      <div class="product-card__header">
        <img src="${product.image_url}" alt="tent" width="100%">
      </div>
      <div class="product-card__content">
        <div><span class="product-card__price">$${product.special_offer}</span> <span class="product-card__old-price">$${product.original_price}</span></div>
        <div>${product.tagline}</div>
      </div>
    </fluent-card>
  `;
  list.appendChild(listItem);
}

// Make video background transparent by matting
function makeBackgroundTransparent(timestamp) {
  // Throttle the frame rate to 30 FPS to reduce CPU usage
  if (timestamp - previousAnimationFrameTimestamp > 30) {
      video = document.getElementById('video')
      tmpCanvas = document.getElementById('tmpCanvas')
      tmpCanvasContext = tmpCanvas.getContext('2d', { willReadFrequently: true })
      tmpCanvasContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
      if (video.videoWidth > 0) {
          let frame = tmpCanvasContext.getImageData(0, 0, video.videoWidth, video.videoHeight)
          for (let i = 0; i < frame.data.length / 4; i++) {
              let r = frame.data[i * 4 + 0]
              let g = frame.data[i * 4 + 1]
              let b = frame.data[i * 4 + 2]
              
              if (g - 150 > r + b) {
                  // Set alpha to 0 for pixels that are close to green
                  frame.data[i * 4 + 3] = 0
              } else if (g + g > r + b) {
                  // Reduce green part of the green pixels to avoid green edge issue
                  adjustment = (g - (r + b) / 2) / 3
                  r += adjustment
                  g -= adjustment * 2
                  b += adjustment
                  frame.data[i * 4 + 0] = r
                  frame.data[i * 4 + 1] = g
                  frame.data[i * 4 + 2] = b
                  // Reduce alpha part for green pixels to make the edge smoother
                  a = Math.max(0, 255 - adjustment * 4)
                  frame.data[i * 4 + 3] = a
              }
          }

          canvas = document.getElementById('canvas')
          canvasContext = canvas.getContext('2d')
          canvasContext.putImageData(frame, 0, 0);
      }

      previousAnimationFrameTimestamp = timestamp
  }

  window.requestAnimationFrame(makeBackgroundTransparent)
}
