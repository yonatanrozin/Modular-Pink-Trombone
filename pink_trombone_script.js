//set maximum allowed # of voices depending on CPU
const options = {
  maxVoices: 5
};

window.AudioContext = window.AudioContext || window.webkitAudioContext;
window.audioContext = new window.AudioContext();

export const voices = [];

// filter cutoff frequencies and Q value for EQ filter
// modify/add/remove as desired
const filter = {
  // 1/2 octave bands
  f: JSON.parse(
    "[31, 44, 62, 88, 125, 176, 250, 353, 500, 707, 1000, 1414, 2000, 2828, 4000, 5656, 8000, 11313, 16000]"
  ),
  Q: 2.871
};

//create voice nodes + filter nodes, resume audioContext
export async function pinkTromboneVoicesInit() {
  await audioContext.audioWorklet.addModule(
    "modular_pink_trombone/pink_trombone_processor.js"
  );

  window.gainNode = new GainNode(audioContext);
  gainNode.gain.value = 0;
  gainNode.connect(audioContext.destination);

  /*
   *    Create voice nodes. For each:
   *        Set # inputs to 2, # outputs to 1
   *        Create a white noise node (looping random 2s waveform)
   *        Pass white noise through 2 filters in parallel
   *        Connect both filters to different inputs of the voice node
   *            Input 0 = aspiration noise, input 1 = fricative noise
   *        Create EQ filter nodes according to specified mode
   *        Connect voice source to filter nodes in series + output to destination
   */
  for (let v = 0; v < options.maxVoices; v++) {
    let voiceNode = new AudioWorkletNode(audioContext, "voice", {
      numberOfInputs: 2, //one for aspiration noise, one for fricative noise
      numberOfOutputs: 1,
      outputChannelCount: [2], //stereo
      processorOptions: { voiceNum: v }
    });

    voiceNode.port.onmessage = function(msg) {
      voiceNode.tractDiameters = msg.data;
    };

    //see pinktrombone AudioSystem.init and AudioSystem.startSound
    let sampleRate = audioContext.sampleRate;
    let buf = audioContext.createBuffer(1, sampleRate * 2, sampleRate);
    let bufSamps = buf.getChannelData(0);
    for (let i = 0; i < sampleRate * 2; i++) {
      bufSamps[i] = Math.random();
    }
    let noiseNode = audioContext.createBufferSource();
    noiseNode.buffer = buf;
    noiseNode.loop = true;

    let aspirateFilter = audioContext.createBiquadFilter();
    aspirateFilter.type = "bandpass";
    aspirateFilter.frequency.value = 500;
    aspirateFilter.Q.value = 0.5;
    noiseNode.connect(aspirateFilter);
    aspirateFilter.connect(voiceNode, 0, 0);

    let fricativeFilter = audioContext.createBiquadFilter();
    fricativeFilter.type = "bandpass";
    fricativeFilter.frequency.value = 1000;
    fricativeFilter.Q.value = 0.5;
    noiseNode.connect(fricativeFilter);
    fricativeFilter.connect(voiceNode, 0, 1);
    noiseNode.start();

    let filterFreqs = filter.f;

    //create filter nodes according to # and value of frequencies
    voiceNode.filters = filterFreqs.map((f, i) => {
      let fType;
      if (i == 0) fType = "lowshelf";
      else if (i == filterFreqs.length - 1) fType = "highshelf";
      else fType = "peaking";

      let filterNode = new BiquadFilterNode(audioContext);
      filterNode.type = fType;
      filterNode.frequency.value = f;
      filterNode.Q.value = filter.Q;
      filterNode.gain.value = 0;
      return filterNode;
    });

    //connect voice -> first filter -> all filters in series -> audio destination
    for (let i in voiceNode.filters) {
      if (i == 0) voiceNode.connect(voiceNode.filters[0]);
      if (i == voiceNode.filters.length - 1) {
        //create pointer to last filter (filtered voice output)
        voiceNode.outputFilter = voiceNode.filters[i];
        voiceNode.outputFilter.connect(gainNode);
      }
      if (i > 0) {
        voiceNode.filters[i - 1].connect(voiceNode.filters[i]);
      }
    }
    voices[v] = voiceNode; //add node to voices array
  }

  audioContext.resume(); //resume in case paused by default
  console.log("audio context initiated.");
}