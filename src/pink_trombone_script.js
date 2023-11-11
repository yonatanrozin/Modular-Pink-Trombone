/*
Options: make sure these are set BEFORE calling pinkTromboneVoicesInit!!!
    maxVoices: number of voices to create - limit this according to processing power
        Setting too high will causes audible pops!
    n: default tract length (in segs) of created voices - original Pink Trombone value is 44
        voice tract length can be changed after initialization using Voice.setN
*/
export const options = {
    maxVoices: 1,
    n: 44,
    filterCount: 20,
    bands_per_octave: 3 //set to 1, 2 or 3 for octave, half-octave or third-octave bands
};

export let ctxInitiated = false;

//an array to hold created voice nodes
export const voices = [];

/*
Creates a series of pink trombone audio processor nodes, inserting them in parallel into the audio context
Args:
    module_path: the path to pink_trombone_processor.js, relative to the script calling this function (not this script!)
    ctx: the audio context to contain the nodes
    destination: the audio node to output the voices to. Defaults to audiocontext audio destination
    UI_DOM_element (optional): an HTML element to append the voice GUIs to
*/
export async function pinkTromboneVoicesInit(module_path, ctx, destination = ctx.destination, UI_DOM_element) {

    if (ctxInitiated) {
        console.log("Context already initiated.");
        return;
    }

    await ctx.audioWorklet.addModule(module_path);
    console.log('modular pink trombone loaded successfully.');

    if (!ctx instanceof AudioContext) throw new Error('invalid AudioContext.');
    if (!destination instanceof AudioNode) throw new Error('invalid audio destination.');

    for (let i = 0; i < options.maxVoices; i++) {
        let tractCanvas;
        if (UI_DOM_element) {
            let tractDiv = document.createElement('div');
            tractDiv.setAttribute('class', `MPT_voice_UI_container`);
            tractCanvas = document.createElement('canvas');
            tractCanvas.style="height: 100%";
            tractCanvas.width=600;
            tractCanvas.height=600;
            tractDiv.appendChild(tractCanvas);
            UI_DOM_element.appendChild(tractDiv);
        }
        voices.push(new Voice(i, ctx, destination, options.n, options.filterCount, tractCanvas));
    }
    
    ctx.resume(); //resume in case paused by default

    ctxInitiated = true;
    console.log("audio context initiated.");
}

/*
MPT voice class
args:
    i: the identifying number for this voice
    ctx: the AudioContext to use
    destination: the AudioNode all the voices will output to
    n: vocal tract length, in segments
    glottisFilterNodeCount: the number of BiquadFilterNodes between glottis and tract
    tractCanvas: the canvas HTML element to draw the tract onto (optional)
*/
class Voice {
    constructor(i, ctx, destination, n=44, glottisFilterNodeCount = 0, tractCanvas = null) {

        this.ctx = ctx;

        this.i = i; //identifying number of this voice (counting from 0)
        this.n = n; //tract segment count
        this.glottisFilters = []; //array of biquad filters between glottis and tract
        this.tractUI = tractCanvas ? new TractUI(tractCanvas, this) : null; //canvas to draw tract

        //audionode producing a raw glottal output
        this.glottis = new AudioWorkletNode(ctx, "glottis", {
            numberOfInputs: 1, //one for aspiration noise
            numberOfOutputs: 1,
            outputChannelCount: [1], 
            processorOptions: { voiceNum: i, n: n }
        });

        //audionode filtering glottal output according to tract info
        this.tract = new AudioWorkletNode(ctx, "tract", {
            numberOfInputs: 2, //one for glottal signal, one for fricative noise
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { voiceNum: i, n: n }
        });

        //a node to get glottis frequency domain data
        this.analyser = new AnalyserNode(ctx);
        this.analyser.fftSize = 8192;

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
        fricativeFilter.connect(this.tract, 0, 1);

        //insert filters between glottis and tract if glottisFilterNodeCount is defined
        if (glottisFilterNodeCount) { 
            for (let g = 0; g < glottisFilterNodeCount; g++) {
                let filterNode = new BiquadFilterNode(ctx);
                if (options.bands_per_octave == 1) 
                    {filterNode.frequencyRatio = g + 1; filterNode.Q.value = 1.414;}
                else if (options.bands_per_octave == 2) 
                    {filterNode.frequencyRatio = Math.pow(1.4142, g); filterNode.Q.value = 2.871;}
                else if (options.bands_per_octave == 3) 
                    {filterNode.frequencyRatio = Math.pow(1.259921, g); filterNode.Q.value = 4.36;}
                    filterNode.frequency.value = this.glottis.parameters.get('frequency').value * filterNode.frequencyRatio;
                filterNode.type = g == 0 ? 'lowshelf' : g == (glottisFilterNodeCount - 1) ? "highshelf" : "peaking";
                filterNode.gain.value = 0;
                this.glottisFilters.push(filterNode);

                if (this.glottisFilters[g-1]) this.glottisFilters[g-1].connect(filterNode);
            }

            this.glottis.connect(this.glottisFilters[0]);
            this.glottisFilters[this.glottisFilters.length - 1].connect(this.tract);
            this.glottisFilters[this.glottisFilters.length - 1].connect(this.analyser);
            
        } else {
            this.glottis.connect(this.tract, 0, 0); // no glottis filters - connect glottis -> tract directly
            this.glottis.connect(this.analyser);
        }

        this.tract.connect(destination) //connect node to supplied/default destination node

        // ensure glottis + tract loudness, intensity, tenseness values are always in sync (for fricatives)
        const self = this; //to refer to this Voice object from within callbacks
        this.glottis.port.onmessage = function(msg) {
            let data = msg.data;

            self.tract.parameters.get('loudness').value = data.l;
            self.tract.parameters.get('intensity').value = data.i;
            self.tract.parameters.get('tenseness').value = data.t;
            self.tract.parameters.get('frequency').value = data.f;

            self.excitation = msg.data.exc;
        }
        this.tract.port.onmessage = function(msg) {
            self.diameters = msg.data.d;
            self.velum = msg.data.v;
        }

    }

    apply_options(options) {
        if (!(options instanceof Voice_options)) throw new Error("Argument must be a Voice_options class object.");
        if (options.n != this.n) this.setN(options.n);
        this.glottis.port.postMessage({exc: options.excitation})
        this.setFrequency(options.frequency);
        this.glottis.parameters.get('base-tenseness').value = options.tenseness;
        for (let f of this.glottisFilters) f.gain.value = 0; //default to 0 gain (no filter)
        for (let i in options.glottisFilterArray) {
            if (this.glottisFilters[i]) this.glottisFilters[i].gain.value = options.glottisFilterArray[i];
        }
    }

    setN(n) {
        this.n = n;
        this.tract.parameters.get('n').value = n;
        this.tractUI.init(); //reset UI with new n value
    }

    setDiameters(d, targetOnly = false) {
        let resampled;
        if (d.length == this.n) {
            resampled = d;
        } else {
            resampled = new Float64Array(this.n).map((v, i) => {

                let i_scaled = i / (this.n-1) * (d.length-1); //get value location in provided diameters
                let interpVal = i_scaled % 1; //get location between indexes
                if (interpVal == 0) return d[i_scaled];

                let i1 = Math.floor(i_scaled);
                let i2 = Math.floor(i_scaled) + 1;

                return d[i1]*(1-interpVal) + d[i2]*interpVal
                
            });
            console.log(d, resampled)
        }

        this.tract.port.postMessage({td: resampled});
        if (!targetOnly) this.tract.port.postMessage({d: resampled});
    }

    //sets the fundamental frequency of the glottal output and adjusts frequency of glottis filters proportionally
    setFrequency(f) {
        this.glottis.parameters.get('frequency').value = f;
        for (const gFilter of this.glottisFilters) {
            gFilter.frequency.value = f * (gFilter.frequencyRatio);
        }
    }

    getFrequencyData() {
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);
        return dataArray;
    }

    draw() {
        if (this.tractUI) this.tractUI.draw();
    }

}

/*
Voice options - timbral properties for a single MPT voice:
    frequency: glottis fundamental frequency
    tenseness: glottis tenseness scale (0-1)
    glottisFIlterArray: an array of gain values (in dB) applied to each glottis filter
    n: vocal tract segment count - rec 44 for male, 36 for female
*/
export class Voice_options {
    constructor(frequency, tenseness, n, glottisFilterArray=[]) {
        this.frequency = frequency;
        this.tenseness = tenseness;
        this.glottisFilterArray = glottisFilterArray;
        this.n = n;
        // this.excitation = custom_excitation;
    }
}

// Tract UI class, taken from Pink Trombone TractUI object
class TractUI {

    constructor(cnv, voice) {  

        if (!voice instanceof Voice) throw new Error("arg 'voice' must be a Voice class object.")

        this.cnv = cnv;
        this.ctx = this.cnv.getContext('2d');
        this.voice = voice; //pointer to corresponding MPT voice

        this.time = 0;
        this.originX = 340;
        this.originY = 449; 
        this.radius = 298; 
        this.scale = 60;
        this.tongueIndex = 12.9;
        this.tongueDiameter = 2.43;
        this.innerTongueControlRadius = 2.05;
        this.outerTongueControlRadius = 3.5;
        this.tongueTouch = 0;
        this.angleScale = 0.64;
        this.angleOffset = -0.24;
        this.noseOffset = 0.8;
        this.gridOffset = 1.7;
        this.fillColour = 'pink';
        this.lineColour = '#C070C6';

        this.mouseTouch = {alive: false, endTime: 0};
        this.mouseDown = false;
        this.touchesWithMouse = [];

        const self = this;
        this.cnv.addEventListener('mousedown', function(event)
            {this.mouseDown = true; event.preventDefault(); self.startMouse(event);});
        this.cnv.addEventListener('mouseup', function(event)
            {this.mouseDown = false; self.endMouse(event);});
        this.cnv.addEventListener('mousemove', function(event) {
            self.moveMouse(event);
        });    

        this.init();
    }

    init() {

        this.restDiameter = new Float64Array(this.voice.n).fill(undefined);

        this.bladeStart = Math.floor(10 * this.voice.n / 44);
        this.tipStart = Math.floor(32 * this.voice.n / 44);
        this.lipStart = Math.floor(39 * this.voice.n / 44);

        this.noseLength = Math.floor(28 * this.voice.n / 44);
        this.noseStart = this.voice.n - this.noseLength + 1;
        this.noseDiameter = new Float64Array(this.noseLength);
        for (var i = 0; i < this.noseLength; i++) {
          var diameter;
          var d = 2 * (i / this.noseLength);
          if (d < 1) diameter = 0.4 + 1.6 * d;
          else diameter = 0.5 + 1.5 * (2 - d);
          diameter = Math.min(diameter, 1.9);
          this.noseDiameter[i] = diameter;
        }

        this.setRestDiameter();

        this.drawBackground(); 

        //see tract processor Tract.init()
        this.tongueLowerIndexBound = this.bladeStart + 2; 
        this.tongueUpperIndexBound = this.tipStart - 3;   
        this.tongueIndexCentre = 0.5*(this.tongueLowerIndexBound+this.tongueUpperIndexBound);
    }
    
    moveTo(i,d) 
    {
        var angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        // var wobble = (Tract.maxAmplitude[Tract.n-1]+Tract.noseMaxAmplitude[Tract.noseLengths-1]);
        // wobble *= 0.03*Math.sin(2*i-50*time)*i/Tract.n;
        // angle += wobble;        
        var wobble = 0; //remove this line to add wobble
        var r = this.radius - this.scale*d + 100*wobble;
        var x = this.originX-r*Math.cos(angle);
        var y = this.originY-r*Math.sin(angle);
        this.ctx.moveTo(x, y);
    }
    
    lineTo(i,d) 
    {
        var angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        // var wobble = (Tract.maxAmplitude[Tract.n-1]+Tract.noseMaxAmplitude[Tract.noseLength-1]);
        // wobble *= 0.03*Math.sin(2*i-50*time)*i/Tract.n;
        // angle += wobble;       
        var wobble = 0; //remove this line to add wobble
        var r = this.radius - this.scale*d + 100*wobble;
        var x = this.originX-r*Math.cos(angle);
        var y = this.originY-r*Math.sin(angle);
        this.ctx.lineTo(x, y);
    }
    
    drawText(i,d,text)
    {
        var angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        var r = this.radius - this.scale*d; 
        this.ctx.save();
        this.ctx.translate(this.originX-r*Math.cos(angle), this.originY-r*Math.sin(angle)+2); //+8);
        this.ctx.rotate(angle-Math.PI/2);
        this.ctx.fillText(text, 0, 0);
        this.ctx.restore();
    }
    
    drawTextStraight(i,d,text)
    {
        var angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        var r = this.radius - this.scale*d; 
        this.ctx.save();
        this.ctx.translate(this.originX-r*Math.cos(angle), this.originY-r*Math.sin(angle)+2); //+8);
        this.ctx.fillText(text, 0, 0);
        this.ctx.restore();
    }
    
    drawCircle(i,d,radius)
    {
        var angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        var r = this.radius - this.scale*d; 
        this.ctx.beginPath();
        this.ctx.arc(this.originX-r*Math.cos(angle), this.originY-r*Math.sin(angle), radius, 0, 2*Math.PI);
        this.ctx.fill();
    }
        
    getIndex(x,y)
    {
        var xx = x-this.originX; var yy = y-this.originY;
        var angle = Math.atan2(yy, xx);
        while (angle> 0) angle -= 2*Math.PI;
        return (Math.PI + angle - this.angleOffset)*(this.lipStart-1) / (this.angleScale*Math.PI);
    }

    getDiameter(x,y)
    {
        var xx = x-this.originX; var yy = y-this.originY;
        return (this.radius-Math.sqrt(xx*xx + yy*yy))/this.scale;
    }
    
    draw()
    {
        this.time = Date.now()/1000;

        if (!this.voice.diameters) return;

        this.ctx.clearRect(0, 0, this.cnv.width, this.cnv.height);
        this.ctx.lineCap = 'round';        
        this.ctx.lineJoin = 'round';  
        
        this.drawTongueControl();
        // this.drawPitchControl();
        
        var velum = this.voice.velum;
        var velumAngle = velum * 4;
        
        //first draw fill
        this.ctx.beginPath();        
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = this.fillColour;
        this.ctx.fillStyle = this.fillColour;

        this.moveTo(1,0);
        for (var i = 1; i < this.voice.n; i++) {
            this.lineTo(i, this.voice.diameters[i]);
        }
        for (var i = this.voice.n-1; i >= 2; i--) this.lineTo(i, 0);  
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.fill();
        
        //for nose
        this.ctx.beginPath();        
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = this.fillColour;
        this.ctx.fillStyle = this.fillColour;
        this.moveTo(this.noseStart, -this.noseOffset);
        for (var i = 1; i < this.noseLength; i++) this.lineTo(i+this.noseStart, -this.noseOffset - this.noseDiameter[i]*0.9);
        for (var i = this.noseLength-1; i >= 1; i--) this.lineTo(i+this.noseStart, -this.noseOffset);  
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.fill();
        
        //velum
        this.ctx.beginPath();
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = this.fillColour;
        this.ctx.fillStyle = this.fillColour;
        this.moveTo(this.noseStart-2, 0);
        this.lineTo(this.noseStart, -this.noseOffset);
        this.lineTo(this.noseStart+velumAngle, -this.noseOffset);
        this.lineTo(this.noseStart+velumAngle-2, 0);
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.fill();
        
        //white text
        this.ctx.fillStyle = "white";
        this.ctx.font="20px Arial";
        this.ctx.textAlign = "center";
        this.ctx.globalAlpha = 1.0;
        this.drawText(this.voice.n*0.10, 0.425, "throat");         
        this.drawText(this.voice.n*0.71, -1.8, "nasal");
        this.drawText(this.voice.n*0.71, -1.3, "cavity");
        this.ctx.font="22px Arial";        
        this.drawText(this.voice.n*0.6, 0.9, "oral");    
        this.drawText(this.voice.n*0.7, 0.9, "cavity");     
  
        this.drawAmplitudes(); 

        //then draw lines
        this.ctx.beginPath();        
        this.ctx.lineWidth = 5;
        this.ctx.strokeStyle = this.lineColour;
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';          
        this.moveTo(1, this.voice.diameters[0]);
        for (var i = 2; i < this.voice.n; i++) this.lineTo(i, this.voice.diameters[i]);
        this.moveTo(1,0);
        for (var i = 2; i <= this.noseStart-2; i++) this.lineTo(i, 0);
        this.moveTo(this.noseStart+velumAngle-2,0);
        for (var i = this.noseStart+Math.ceil(velumAngle)-2; i < this.voice.n; i++) this.lineTo(i, 0);   
        this.ctx.stroke();
        
        //for nose
        this.ctx.beginPath();        
        this.ctx.lineWidth = 5;
        this.ctx.strokeStyle = this.lineColour;
        this.ctx.lineJoin = 'round';  
        this.moveTo(this.noseStart, -this.noseOffset);
        for (var i = 1; i < this.noseLength; i++) this.lineTo(i+this.noseStart, -this.noseOffset - this.noseDiameter[i]*0.9);
        this.moveTo(this.noseStart+velumAngle, -this.noseOffset);
        for (var i = Math.ceil(velumAngle); i < this.noseLength; i++) this.lineTo(i+this.noseStart, -this.noseOffset);
        this.ctx.stroke();
                
        //velum
        this.ctx.globalAlpha = velum*5;
        this.ctx.beginPath();
        this.moveTo(this.noseStart-2, 0);
        this.lineTo(this.noseStart, -this.noseOffset);
        this.moveTo(this.noseStart+velumAngle-2, 0);
        this.lineTo(this.noseStart+velumAngle, -this.noseOffset);  
        this.ctx.stroke();
        
        this.ctx.fillStyle = "orchid";
        this.ctx.font="20px Arial";
        this.ctx.textAlign = "center";
        this.ctx.globalAlpha = 0.7;
        this.drawText(this.voice.n*0.95, 0.8+0.8*this.voice.diameters[this.voice.n-1], " lip"); 

        //this.drawPositions();
        this.drawBackground();        
    }
    
    drawBackground()
    {
        // this.ctx = backCtx;
        
        //text
        this.ctx.fillStyle = "orchid";
        this.ctx.font="20px Arial";
        this.ctx.textAlign = "center";
        this.ctx.globalAlpha = 0.7;
        this.drawText(this.voice.n*0.44, -0.28, "soft");
        this.drawText(this.voice.n*0.51, -0.28, "palate");
        this.drawText(this.voice.n*0.77, -0.28, "hard");
        this.drawText(this.voice.n*0.84, -0.28, "palate");
        this.drawText(this.voice.n*0.95, -0.28, " lip");
        
        this.ctx.font="17px Arial";        
        this.drawTextStraight(this.voice.n*0.18, 3, "  tongue control");   
        this.ctx.textAlign = "left";
        this.drawText(this.voice.n*1.03, -1.07, "nasals");
        this.drawText(this.voice.n*1.03, -0.28, "stops");
        this.drawText(this.voice.n*1.03, 0.51, "fricatives");
        //this.drawTextStraight(1.5, +0.8, "glottis")
        this.ctx.strokeStyle = "orchid";
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.moveTo(this.voice.n*1.03, 0); this.lineTo(this.voice.n*1.07, 0); 
        this.moveTo(this.voice.n*1.03, -this.noseOffset); this.lineTo(this.voice.n*1.07,  -this.noseOffset); 
        this.ctx.stroke();
        this.ctx.globalAlpha = 0.9;
        this.ctx.globalAlpha = 1.0;
        // this.ctx = tractCtx;
    }
    
    drawPositions()
    {
        this.ctx.fillStyle = "orchid";
        this.ctx.font="24px Arial";
        this.ctx.textAlign = "center";
        this.ctx.globalAlpha = 0.6;
        var a = 2;
        var b = 1.5;
        this.drawText(15, a+b*0.60, 'æ'); //pat
        this.drawText(13, a+b*0.27, 'ɑ'); //part
        this.drawText(12, a+b*0.00, 'ɒ'); //pot
        this.drawText(17.7, a+b*0.05, '(ɔ)'); //port (rounded)
        this.drawText(27, a+b*0.65, 'ɪ'); //pit
        this.drawText(27.4, a+b*0.21, 'i'); //peat
        this.drawText(20, a+b*1.00, 'e'); //pet
        this.drawText(18.1, a+b*0.37, 'ʌ'); //putt   
            //put ʊ
        this.drawText(23, a+b*0.1, '(u)'); //poot (rounded)   
        this.drawText(21, a+b*0.6, 'ə'); //pert [should be ɜ]
        
        var nasals = -1.1;
        var stops = -0.4;
        var fricatives = 0.3;
        var approximants = 1.1;
        this.ctx.globalAlpha = 0.8;
        
        //approximants
        this.drawText(38, approximants, 'l');
        this.drawText(41, approximants, 'w');
        
        //?
        this.drawText(4.5, 0.37, 'h');
        
        // if (Glottis.isTouched || alwaysVoice)
        // {
        //     //voiced consonants
        //     this.drawText(31.5, fricatives, 'ʒ');     
        //     this.drawText(36, fricatives, 'z');
        //     this.drawText(41, fricatives, 'v');
        //     this.drawText(22, stops, 'g');
        //     this.drawText(36, stops, 'd');
        //     this.drawText(41, stops, 'b');
        //     this.drawText(22, nasals, 'ŋ');
        //     this.drawText(36, nasals, 'n');
        //     this.drawText(41, nasals, 'm');  
        // }
        // else
        {
            //unvoiced consonants
            this.drawText(31.5, fricatives, 'ʃ'); 
            this.drawText(36, fricatives, 's');
            this.drawText(41, fricatives, 'f');
            this.drawText(22, stops, 'k');
            this.drawText(36, stops, 't');
            this.drawText(41, stops, 'p');
            this.drawText(22, nasals, 'ŋ');
            this.drawText(36, nasals, 'n');
            this.drawText(41, nasals, 'm');  
        }
    }
    
    drawAmplitudes()
    {
        this.ctx.strokeStyle = "orchid";
        this.ctx.lineCap = "butt";
        this.ctx.globalAlpha = 0.3;
        for (var i=2; i<this.voice.n-1; i++)
        {
            this.ctx.beginPath();
            this.ctx.lineWidth = 1; //Math.sqrt(Tract.maxAmplitude[i])*3;
            this.moveTo(i, 0);
            this.lineTo(i, this.voice.diameters[i]);
            this.ctx.stroke();
        }
        for (var i=1; i<this.noseLength-1; i++)
        {
            this.ctx.beginPath();
            this.ctx.lineWidth = 1; //Math.sqrt(Tract.noseMaxAmplitude[i]) * 3;
            this.moveTo(i+this.noseStart, -this.noseOffset);
            this.lineTo(i+this.noseStart, -this.noseOffset - this.noseDiameter[i]*0.9);
            this.ctx.stroke();
        }
        this.ctx.globalAlpha = 1;
    }
    
    drawTongueControl()
    {
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.strokeStyle = "#ffeef5"; //pale pink
        this.ctx.fillStyle = "#ffeef5";
        this.ctx.globalAlpha = 1.0;
        this.ctx.beginPath();
        this.ctx.lineWidth = 45;
        
        //outline
        this.moveTo(this.tongueLowerIndexBound, this.innerTongueControlRadius);
        for (var i=this.tongueLowerIndexBound+1; i<=this.tongueUpperIndexBound; i++) this.lineTo(i, this.innerTongueControlRadius);
        this.lineTo(this.tongueIndexCentre, this.outerTongueControlRadius);
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.fill();
        
        var a = this.innerTongueControlRadius;
        var c = this.outerTongueControlRadius;
        var b = 0.5*(a+c);
        var r = 3;
        this.ctx.fillStyle = "orchid";
        this.ctx.globalAlpha = 0.3;        
        this.drawCircle(this.tongueIndexCentre, a, r);
        this.drawCircle(this.tongueIndexCentre-4.25, a, r);
        this.drawCircle(this.tongueIndexCentre-8.5, a, r);
        this.drawCircle(this.tongueIndexCentre+4.25, a, r);
        this.drawCircle(this.tongueIndexCentre+8.5, a, r);
        this.drawCircle(this.tongueIndexCentre-6.1, b, r);    
        this.drawCircle(this.tongueIndexCentre+6.1, b, r);  
        this.drawCircle(this.tongueIndexCentre, b, r);  
        this.drawCircle(this.tongueIndexCentre, c, r);
        
        this.ctx.globalAlpha = 1.0;         

        //circle for tongue position
        var angle = this.angleOffset + this.tongueIndex * this.angleScale * Math.PI / (this.lipStart-1);
        var r = this.radius - this.scale*(this.tongueDiameter);
        var x = this.originX-r*Math.cos(angle);
        var y = this.originY-r*Math.sin(angle);
        this.ctx.lineWidth = 4;
        this.ctx.strokeStyle = "orchid";
        this.ctx.globalAlpha = 0.7;
        this.ctx.beginPath();
        this.ctx.arc(x,y, 18, 0, 2*Math.PI);
        this.ctx.stroke();        
        this.ctx.globalAlpha = 0.15;
        this.ctx.fill();
        this.ctx.globalAlpha = 1.0;
        
        this.ctx.fillStyle = "orchid";
    }
    
    // drawPitchControl()
    // {
    //     var w=9;
    //     var h=15;
    //     if (Glottis.x)
    //     {
    //         this.ctx.lineWidth = 4;
    //         this.ctx.strokeStyle = "orchid";
    //         this.ctx.globalAlpha = 0.7;
    //         this.ctx.beginPath();
    //         this.ctx.moveTo(Glottis.x-w, Glottis.y-h);
    //         this.ctx.lineTo(Glottis.x+w, Glottis.y-h);
    //         this.ctx.lineTo(Glottis.x+w, Glottis.y+h);
    //         this.ctx.lineTo(Glottis.x-w, Glottis.y+h);                    
    //         this.ctx.closePath();            
    //         this.ctx.stroke();    
    //         this.ctx.globalAlpha = 0.15;
    //         this.ctx.fill();            
    //         this.ctx.globalAlpha = 1.0;
    //     }
    // }
    
    setRestDiameter()
    {
        for (var i=this.bladeStart; i<this.lipStart; i++)
        {
            var t = 1.1 * Math.PI*(this.tongueIndex - i)/(this.tipStart - this.bladeStart);
            var fixedTongueDiameter = 2+(this.tongueDiameter-2)/1.5;
            var curve = (1.5-fixedTongueDiameter+this.gridOffset)*Math.cos(t);
            if (i == this.bladeStart-2 || i == this.lipStart-1) curve *= 0.8;
            if (i == this.bladeStart || i == this.lipStart-2) curve *= 0.94;               
            this.restDiameter[i] = 1.5 - curve;
        }
    }

    startMouse(event)
    {
        var touch = {};
        touch.startTime = this.time;
        touch.fricative_intensity = 0;
        touch.endTime = 0;
        touch.alive = true;
        touch.id = "mouse" + Math.random();
        touch.x = (event.pageX-this.cnv.offsetLeft)/this.cnv.getBoundingClientRect().width*600;
        touch.y = (event.pageY-this.cnv.offsetTop)/this.cnv.getBoundingClientRect().width*600;

        touch.index = this.getIndex(touch.x, touch.y);
        touch.diameter = this.getDiameter(touch.x, touch.y);

        if (touch.index >= this.tongueLowerIndexBound-4 && touch.index<=this.tongueUpperIndexBound+4 
            && touch.diameter >= this.innerTongueControlRadius-0.5 && touch.diameter <= this.outerTongueControlRadius+0.5)
        {
            console.log("tongue")
            this.tongueTouch = touch;
        }

        this.mouseTouch = touch;
        this.touchesWithMouse.push(touch);   
        this.handleTouches();
    }

    endMouse()
    {
        var touch = this.mouseTouch;
        if (!touch.alive) return;
        touch.alive = false;
        touch.endTime = this.time; 
        this.handleTouches();
    }

    moveMouse(event)
    {
        var touch = this.mouseTouch;
        if (!touch.alive) return;
        touch.x = (event.pageX-this.cnv.offsetLeft)/this.cnv.getBoundingClientRect().width*600;
        touch.y = (event.pageY-this.cnv.offsetTop)/this.cnv.getBoundingClientRect().width*600;
        touch.index = this.getIndex(touch.x, touch.y);
        touch.diameter = this.getDiameter(touch.x, touch.y); 
        this.handleTouches();
    }
    
    handleTouches()
    {           
        if (this.tongueTouch != 0 && !this.tongueTouch.alive) this.tongueTouch = 0;
        
        if (this.tongueTouch == 0)
        {        
            for (var j=0; j<this.touchesWithMouse.length; j++)  
            {
                var touch = this.touchesWithMouse[j];
                if (!touch.alive) continue;
                if (touch.fricative_intensity == 1) continue; //only new touches will pass this
                var x = touch.x;
                var y = touch.y;        
                var index = this.getIndex(x,y);
                var diameter = this.getDiameter(x,y);
                this.voice.tract.parameters.get('constriction-index').value = index;
                this.voice.tract.parameters.get('constriction-diameter').value = diameter;
                // if (index >= this.tongueLowerIndexBound-4 && index<=this.tongueUpperIndexBound+4 
                //     && diameter >= this.innerTongueControlRadius-0.5 && diameter <= this.outerTongueControlRadius+0.5)
                // {
                //     console.log("tongue")
                //     this.tongueTouch = touch;
                // }
            }    
        }
        
        if (this.tongueTouch != 0)
        {
            var x = this.tongueTouch.x;
            var y = this.tongueTouch.y;        
            var index = this.getIndex(x,y);
            var diameter = this.getDiameter(x,y);
            this.voice.tract.parameters.get('constriction-index').value = index;
            this.voice.tract.parameters.get('constriction-diameter').value = diameter;
            var fromPoint = (this.outerTongueControlRadius-diameter)/(this.outerTongueControlRadius-this.innerTongueControlRadius);
            fromPoint = Math.clamp(fromPoint, 0, 1);
            fromPoint = Math.pow(fromPoint, 0.58) - 0.2*(fromPoint*fromPoint-fromPoint); 
            this.tongueDiameter = Math.clamp(diameter, this.innerTongueControlRadius, this.outerTongueControlRadius);
            //this.tongueIndex = Math.clamp(index, this.tongueLowerIndexBound, this.tongueUpperIndexBound);
            var out = fromPoint*0.5*(this.tongueUpperIndexBound-this.tongueLowerIndexBound);
            this.tongueIndex = Math.clamp(index, this.tongueIndexCentre-out, this.tongueIndexCentre+out);
        }

        this.setRestDiameter();  
                
        //other constrictions and nose
        this.voice.tract.parameters.get('velum-target').value = 0.01;

        for (var j=0; j<this.touchesWithMouse.length; j++) 
        {
            var touch = this.touchesWithMouse[j];
            if (!touch.alive) continue;            
            var x = touch.x;
            var y = touch.y;
            var index = this.getIndex(x,y);
            var diameter = this.getDiameter(x,y);

            if (index > this.noseStart && diameter < -this.noseOffset)
            {         
                this.voice.tract.parameters.get('velum-target').value = 0.4;
            }            
            // this.temp.a = index;
            // this.temp.b = diameter;
            if (diameter < -0.85-this.noseOffset) continue;
            diameter -= 0.3;
            if (diameter<0) diameter = 0;         
            var width=2;
            if (index<25) width = 10;
            else if (index>=this.tipStart) width= 5;
            else width = 10-5*(index-25)/(this.tipStart-25);
            if (index >= 2 && index < this.voice.n && y<this.cnv.height && diameter < 3) 
            {
                let intIndex = Math.round(index);
                for (var i=-Math.ceil(width)-1; i<width+1; i++) 
                {   
                    if (intIndex+i<0 || intIndex+i>=this.voice.n) continue;
                    var relpos = (intIndex+i) - index;
                    relpos = Math.abs(relpos)-0.5;
                    var shrink;
                    if (relpos <= 0) shrink = 0;
                    else if (relpos > width) shrink = 1;
                    else shrink = 0.5*(1-Math.cos(Math.PI * relpos / width));
                    // if (diameter < Tract.targetDiameter[intIndex+i])
                    if (isNaN(this.restDiameter[intIndex+i]) || diameter < this.restDiameter[intIndex+i] )

                    {
                        this.restDiameter[intIndex+i] = diameter + (this.restDiameter[intIndex+i]-diameter)*shrink;
                    }
                }
            }
        }      

        const diameters = this.restDiameter.map((v, i) => 
            isNaN(v) ? this.voice.diameters[i] : v
        )
        this.voice.setDiameters(diameters, true);
    }
}

Math.clamp = function(number, min, max) {
    if (number<min) return min;
    else if (number>max) return max;
    else return number;
}