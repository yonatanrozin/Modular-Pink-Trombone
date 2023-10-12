//set maximum allowed # of voices depending on CPU
export const options = {
    maxVoices: 1,
    filter: {
        f: JSON.parse(
            "[31, 44, 62, 88, 125, 176, 250, 353, 500, 707, 1000, 1414, 2000, 2828, 4000, 5656, 8000, 11313, 16000]"
        ),
        Q: 2.871
    },
    n: 44
};

export let ctxInitiated = false;

//an array to hold created voice nodes
export const voices = [];

/*
    Args: an audioContext and a destination node (will default to context.destination)
        Creates # of pink trombone voices according to options.maxVoices
        Creates filters for each individual voice according to options.filter
*/
export async function pinkTromboneVoicesInit(ctx, destination = ctx.destination) {

    if (ctxInitiated) {
        console.log("Context already initiated.")
        return
    }

    await ctx.audioWorklet.addModule(
        "./MPT/pink_trombone_processor.js"
    );
    console.log('modular pink trombone loaded successfully.')

    if (!ctx instanceof AudioContext) throw new Error('invalid AudioContext.');
    if (!destination instanceof AudioNode) throw new Error('invalid audio destination.');

    for (let i = 0; i < options.maxVoices; i++) {
        voices.push(new MPTvoice(i, ctx, destination, options.n, 10))
    }
    
    ctx.resume(); //resume in case paused by default

    ctxInitiated = true;
    console.log("audio context initiated.");

    return 

    /*
    Create voice nodes. For each:
        Set # inputs to 2, # outputs to 1
        Create a white noise node (looping random 2s waveform)
        Pass white noise through 2 filters in parallel
        Connect both filters to different inputs of the voice node
            Input 0 = aspiration noise, input 1 = fricative noise
        Create EQ filter nodes according to specified mode
        Connect voice source to filter nodes in series + output to destination
    */ 
    for (let v = 0; v < options.maxVoices; v++) {
        let glottisNode = new AudioWorkletNode(ctx, "glottis", {
            numberOfInputs: 1, //one for aspiration noise
            numberOfOutputs: 1,
            outputChannelCount: [1], 
            processorOptions: { voiceNum: v, n: options.n }
        });
        let tractNode = new AudioWorkletNode(ctx, "tract", {
            numberOfInputs: 2, //one for glottal signal, one for fricative noise
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { voiceNum: v, n: options.n }
        })
        


        // voiceNode.port.onmessage = (e) => {
        //     let data = e.data
        //     if (data.d) voiceNode.tractDiameters = data.d;
        //     if (data.exc) voiceNode.excitation = data.exc;
        // }

        //see pinktrombone AudioSystem.init and AudioSystem.startSound
        let sampleRate = ctx.sampleRate;
        let buf = ctx.createBuffer(1, sampleRate * 2, sampleRate);
        let bufSamps = buf.getChannelData(0);
        for (let i = 0; i < sampleRate * 2; i++) { 
            bufSamps[i] = Math.random();
        };
        let noiseNode = ctx.createBufferSource();
        noiseNode.buffer = buf;
        noiseNode.loop = true;

        noiseNode.start();

        let aspirateFilter = ctx.createBiquadFilter();
        aspirateFilter.type = "bandpass";
        aspirateFilter.frequency.value = 500;
        aspirateFilter.Q.value = 0.5;
        noiseNode.connect(aspirateFilter);
        
        // CONNECT THIS ONE TO TRACT, NOT TO GLOTTIS!!
        let fricativeFilter = ctx.createBiquadFilter();
        fricativeFilter.type = "bandpass";
        fricativeFilter.frequency.value = 1000;
        fricativeFilter.Q.value = 0.5;
        noiseNode.connect(fricativeFilter);
        
        aspirateFilter.connect(glottisNode, 0, 0);
        glottisNode.connect(tractNode, 0, 0)
        fricativeFilter.connect(tractNode, 0, 1);

        // let filterFreqs = options.filter.f;
        // voiceNode.filters = filterFreqs.map((f, i) => {
        //     let fType;
        //     if (i == 0) fType = "lowshelf";
        //     else if (i == filterFreqs.length - 1) fType = "highshelf";
        //     else fType = "peaking";
        //     let filterNode = new BiquadFilterNode(ctx);
        //     filterNode.type = fType;
        //     filterNode.frequency.value = f;
        //     filterNode.Q.value = options.filter.Q;
        //     filterNode.gain.value = 0;
        //     return filterNode;
        // });

        // //connect voice -> first filter -> all filters in series -> audio destination
        // for (let i in voiceNode.filters) {
        //     if (i == 0) voiceNode.connect(voiceNode.filters[0]);
        //     if (i == voiceNode.filters.length - 1) {
        //         //create pointer to last filter (filtered voice output)
        //         voiceNode.outputNode = voiceNode.filters[i];
        //         voiceNode.outputNode.connect(destination);
        //     }
        //     if (i > 0) {
        //         voiceNode.filters[i - 1].connect(voiceNode.filters[i]);
        //     };
        // };

        tractNode.connect(destination) 

        voices[v] = {tract: tractNode, glottis: glottisNode}; //add references to nodes (TODO: ADD FILTERS TOO)
    }

    ctx.resume(); //resume in case paused by default

    ctxInitiated = true;
    console.log("audio context initiated.");
}

class MPTvoice {
    constructor(i, ctx, destination, n, glottisFilterNodeCount = 0) {

        this.i = i;
        this.n = n;
        this.glottisFilters = [];

        this.glottis = new AudioWorkletNode(ctx, "glottis", {
            numberOfInputs: 1, //one for aspiration noise
            numberOfOutputs: 1,
            outputChannelCount: [1], 
            processorOptions: { voiceNum: i, n: n }
        });
        this.tract = new AudioWorkletNode(ctx, "tract", {
            numberOfInputs: 2, //one for glottal signal, one for fricative noise
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { voiceNum: i, n: n }
        })

        //see pinktrombone AudioSystem.init and AudioSystem.startSound
        let sampleRate = ctx.sampleRate;
        let buf = ctx.createBuffer(1, sampleRate * 2, sampleRate);
        let bufSamps = buf.getChannelData(0);
        for (let i = 0; i < sampleRate * 2; i++) { 
            bufSamps[i] = Math.random();
        };
        let noiseNode = ctx.createBufferSource();
        noiseNode.buffer = buf;
        noiseNode.loop = true;
        noiseNode.start();

        let aspirateFilter = ctx.createBiquadFilter();
        aspirateFilter.type = "bandpass";
        aspirateFilter.frequency.value = 500;
        aspirateFilter.Q.value = 0.5;
        noiseNode.connect(aspirateFilter);
        
        let fricativeFilter = ctx.createBiquadFilter();
        fricativeFilter.type = "bandpass";
        fricativeFilter.frequency.value = 1000;
        fricativeFilter.Q.value = 0.5;
        noiseNode.connect(fricativeFilter);
        
        aspirateFilter.connect(this.glottis, 0, 0);

        if (glottisFilterNodeCount) { 
            for (let g = 0; g < glottisFilterNodeCount; g++) {
                let filterNode = new BiquadFilterNode(ctx);
                filterNode.harmonicNum = g + 1;
                filterNode.type = g == 0 ? 'lowshelf' : g == (glottisFilterNodeCount - 1) ? "highshelf" : "peaking";
                filterNode.frequency.value = 0;
                filterNode.Q.value = .7071;
                filterNode.gain.value = 0;
                this.glottisFilters.push(filterNode);

                if (this.glottisFilters[g-1]) this.glottisFilters[g-1].connect(filterNode)
            }

            this.glottis.connect(this.glottisFilters[0]);
            this.glottisFilters[this.glottisFilters.length - 1].connect(this.tract);
            
        } else this.glottis.connect(this.tract, 0, 0); // no glottis filters - connect glottis -> tract directly
        
        fricativeFilter.connect(this.tract, 0, 1);

        this.tract.connect(destination) //connect node to supplied/default destination node

        // ensure glottis + tract loudness, intensity, tenseness values are always in sync
        const self = this //to refer to this MPTvoice object from within different scopes
        this.glottis.port.onmessage = function(msg) {
            let data = msg.data;

            self.tract.parameters.get('loudness').value = data.l;
            self.tract.parameters.get('intensity').value = data.i;
            self.tract.parameters.get('tenseness').value = data.t;

            self.excitation = msg.data.exc;
        }
        this.tract.port.onmessage = function(msg) {
            self.diameters = msg.data.d;
        }
    }

    setDiameters(d) {

    }

    setFrequency(f) {
        this.glottis.parameters.get('frequency').value = f;
        for (const gFilter of this.glottisFilters) {
            gFilter.frequency.value = f * (gFilter.harmonicNum + 1);
        }
    }


}