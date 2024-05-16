import { useEffect, useRef, MouseEvent } from "react";

export type RPT_Voice_Preset = {
    n: number,
    frequency: number,
    tenseness: number,
    filters: number[]
}

export default function Tract(props: {voice: RPT_Voice, canvasRef: React.RefObject<HTMLCanvasElement>}) {

    const {voice, canvasRef} = props;

    const animationRef = useRef(0);

    //on component mount, pass 2D render context to voice UI
    useEffect(() => {
        if (!voice) return;
        voice.UI.cnv = canvasRef.current!;
        voice.UI.ctx = canvasRef.current?.getContext('2d')!;

        function getNewFrame() {
            voice!.UI.draw();
            animationRef.current = requestAnimationFrame(getNewFrame);
        }
        getNewFrame();

        return () => cancelAnimationFrame(animationRef.current);
    }, [voice]);

    function startMouse(e: MouseEvent) {
        e.preventDefault();
        voice?.UI.startMouse(e);
    }
    function endMouse() {
        voice?.UI.endMouse();
    }
    function moveMouse(e: MouseEvent) {
        voice?.UI.moveMouse(e);
    }

    return <canvas className="tractCanvas" width={600} height={600} ref={canvasRef} 
        onMouseDown={startMouse} onMouseUp={endMouse} onMouseMove={moveMouse}/>
}

export class RPT_Voice {
    
    name: string | number;
    ctx: AudioContext;
    connected: boolean = false;
    destination: AudioNode;

    glottis: AudioWorkletNode;
    tract: AudioWorkletNode;
    noiseNode: AudioBufferSourceNode;
    aspiration: BiquadFilterNode;
    fricative: BiquadFilterNode;

    d?: Float64Array;
    v: number = 0.4;
    constriction?: {i: number, d: number};
    tongue = {i: 12.9, d: 2.43};

    UI: TractUI;

    newDiametersCallback?: Function;

    //create a new voice using the given audiocontext and destinationNOde (default ctx destination)
    constructor(name: string | number, ctx: AudioContext, destination: AudioNode = ctx.destination) {
        this.name = name;
        this.ctx = ctx;
        this.destination = destination;

        this.glottis = new AudioWorkletNode(this.ctx, 'glottis', {
            numberOfInputs: 1, //aspiration noise
            numberOfOutputs: 2, //glottal source, noise modulator
            outputChannelCount: [1, 1], 
            processorOptions: { name: this.name }
        });

        this.tract = new AudioWorkletNode(this.ctx, "tract", {
            numberOfInputs: 3, //glottal source, fricative noise, noise modulator
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { name: this.name }
        });

        this.tract.port.onmessage = (e) => {
            this.d = e.data.d; 
            this.v = e.data.v;
            this.newDiametersCallback?.();
        };

        const sampleRate = this.ctx.sampleRate;
        const buf = this.ctx.createBuffer(1, sampleRate * 2, sampleRate);
        const bufSamps = buf.getChannelData(0);
        for (let i = 0; i < sampleRate * 2; i++) { 
            bufSamps[i] = Math.random();
        };

        this.noiseNode = this.ctx.createBufferSource();
        this.noiseNode.buffer = buf;
        this.noiseNode.loop = true;
        this.noiseNode.start();

        this.aspiration = this.ctx.createBiquadFilter();
        this.aspiration.type = "bandpass";
        this.aspiration.frequency.value = 500;
        this.aspiration.Q.value = 0.5;
        
        this.fricative = this.ctx.createBiquadFilter();
        this.fricative.type = "bandpass";
        this.fricative.frequency.value = 1000;
        this.fricative.Q.value = 0.5;

        this.UI = new TractUI(this);
    }

    connect() {
        this.noiseNode.connect(this.aspiration);
        this.noiseNode.connect(this.fricative);
        this.aspiration.connect(this.glottis, 0, 0);
        this.fricative.connect(this.tract, 0, 1);
        this.glottis.connect(this.tract, 0, 0);
        this.glottis.connect(this.tract, 1, 2);
        this.tract.connect(this.destination);
        
        console.log(`Voice ${this.name} connected.`);
    }
    
    disconnect() {
        this.glottis.disconnect();
        this.tract.disconnect();
        console.log(`Voice ${this.name} disconnected.`);
    }

    setPreset(preset: RPT_Voice_Preset) {
        this.glottis.parameters.get("frequency")!.value = preset.frequency;
        this.glottis.parameters.get("tenseness")!.value = preset.tenseness;
        this.setN(preset.n);
    }

    setN(n: number) {
        this.tract.parameters.get("n")!.value = n;
        this.UI.init(this.tract.parameters.get("n")!.value);
    }

    setDiameters(d: Float64Array, targetOnly = false) {

        const tract_n = this.tract.parameters.get("n")!.value;

        //resample inputted diameters to tract length
        let resampled = d.length == tract_n ? d 
            : new Float64Array(tract_n).map((v, i) => {
                let i_scaled = i / (tract_n-1) * (d.length-1);
                let interpVal = i_scaled % 1; 
                if (interpVal == 0) return d[i_scaled];

                let i1 = Math.floor(i_scaled);
                let i2 = Math.floor(i_scaled) + 1;

                v = d[i1]*(1-interpVal) + d[i2]*interpVal;
                return v;
            });
        
        this.tract.port.postMessage({td: resampled});
        if (!targetOnly) this.tract.port.postMessage({d: resampled});
    }

    onNewDiameters(callback: Function | undefined) {
        this.newDiametersCallback = callback;
    }
}

export class TractUI {
    // name: number | string;
    ctx?: CanvasRenderingContext2D; //gets assigned a canvas context 
    cnv?: HTMLCanvasElement;
    voice: RPT_Voice; //the corresponding RPTVoice object
    recording: boolean = false;

    time = 0;
    originX = 340;
    originY = 500; 
    radius = 298; 
    scale = 70;
    tongueIndex = 12.9;
    tongueDiameter = 2.43;
    innerTongueControlRadius = 2.05;
    outerTongueControlRadius = 3.5;
    tongueTouch?: Record<string, any>;
    angleScale = 0.64;
    angleOffset = -0.24;
    noseOffset = 0.8;
    gridOffset = 1.7;
    fillColour = 'pink';
    lineColour = '#C070C6';
    
    n = 44;
    restDiameter = new Float64Array();
    bladeStart = 0;
    tipStart = 0;
    lipStart = 0;
    noseLength = 0;
    noseStart = 0;
    noseDiameter = new Float64Array();
    tongueLowerIndexBound = 0;
    tongueUpperIndexBound = 0;
    tongueIndexCentre = 0

    mouseTouch: Record<string, any> = {alive: false};
    touchesWithMouse: any[] = [];

    ignoreTongue = false;

    constructor(voice: RPT_Voice) {
        this.voice = voice;
        // this.name = voice.name;
        this.init();
    }

    init(n = this.n) {

        this.n = n;
        this.restDiameter = new Float64Array(this.n);

        this.bladeStart = Math.floor(10 * this.n / 44);
        this.tipStart = Math.floor(32 * this.n / 44);
        this.lipStart = Math.floor(39 * this.n / 44);

        for (let i=0; i<this.n; i++)
        {
            var diameter = 0;
            if (i<7*this.n/44-0.5) diameter = 0.6;
            else if (i<12*this.n/44) diameter = 1.1;
            else diameter = 1.5;
            this.restDiameter[i] = diameter;
        }

        this.noseLength = Math.floor(28 * this.n / 44);
        this.noseStart = this.n - this.noseLength + 1;
        this.noseDiameter = new Float64Array(this.noseLength);
        for (let i = 0; i < this.noseLength; i++) {
            let diameter;
            let d = 2 * (i / this.noseLength);
            if (d < 1) diameter = 0.4 + 1.6 * d;
            else diameter = 0.5 + 1.5 * (2 - d);
            diameter = Math.min(diameter, 1.9);
            this.noseDiameter[i] = diameter;
        }

        this.setRestDiameter();
        this.voice.tract.port.postMessage({td: this.restDiameter, d: this.restDiameter});

        this.tongueLowerIndexBound = this.bladeStart + 2; 
        this.tongueUpperIndexBound = this.tipStart - 3;   
        this.tongueIndexCentre = 0.5*(this.tongueLowerIndexBound+this.tongueUpperIndexBound);
    }

    setRestDiameter() {
        for (let i=this.bladeStart; i<this.lipStart; i++)
        {
            var t = 1.1 * Math.PI*(this.tongueIndex - i)/(this.tipStart - this.bladeStart);
            var fixedTongueDiameter = 2+(this.tongueDiameter-2)/1.5;
            var curve = (1.5-fixedTongueDiameter+this.gridOffset)*Math.cos(t);
            if (i == this.bladeStart-2 || i == this.lipStart-1) curve *= 0.8;
            if (i == this.bladeStart || i == this.lipStart-2) curve *= 0.94;               
            this.restDiameter[i] = 1.5 - curve;
        }
    }

    draw() {

        this.time = Date.now()/1000;
        if (!this.ctx || !this.voice.d) return;

        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

        this.ctx.lineCap = 'round';        
        this.ctx.lineJoin = 'round';  
        
        this.drawTongueControl();
        
        var velum = this.voice.v;
        var velumAngle = velum * 4;
        
        //first draw fill
        this.ctx.beginPath();        
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = this.fillColour;
        this.ctx.fillStyle = this.fillColour;

        this.moveTo(1,0);
        for (let i = 1; i < this.n; i++) {
            this.lineTo(i, this.voice.d[i]);
        }
        for (let i = this.n-1; i >= 2; i--) this.lineTo(i, 0);  
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.fill();
        
        //for nose
        this.ctx.beginPath();        
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = this.fillColour;
        this.ctx.fillStyle = this.fillColour;
        this.moveTo(this.noseStart, -this.noseOffset);
        for (let i = 1; i < this.noseLength; i++) this.lineTo(i+this.noseStart, -this.noseOffset - this.noseDiameter[i]*0.9);
        for (let i = this.noseLength-1; i >= 1; i--) this.lineTo(i+this.noseStart, -this.noseOffset);  
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
        this.drawText(this.n*0.10, 0.425, "throat");         
        this.drawText(this.n*0.71, -1.8, "nasal");
        this.drawText(this.n*0.71, -1.3, "cavity");
        this.ctx.font="22px Arial";        
        this.drawText(this.n*0.64, 1.1, "oral");    
        this.drawText(this.n*0.74, 1.1, "cavity"); 

        this.drawAmplitudes(); 

        //then draw lines
        this.ctx.beginPath();        
        this.ctx.lineWidth = 5;
        this.ctx.strokeStyle = this.lineColour;
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';          
        this.moveTo(1, this.voice.d[0]);
        for (let i = 2; i < this.n; i++) this.lineTo(i, this.voice.d[i]);
        this.moveTo(1,0);
        for (let i = 2; i <= this.noseStart-2; i++) this.lineTo(i, 0);
        this.moveTo(this.noseStart+velumAngle-2,0);
        for (let i = this.noseStart+Math.ceil(velumAngle)-2; i < this.n; i++) this.lineTo(i, 0);   
        this.ctx.stroke();

        //for nose
        this.ctx.beginPath();        
        this.ctx.lineWidth = 5;
        this.ctx.strokeStyle = this.lineColour;
        this.ctx.lineJoin = 'round';  
        this.moveTo(this.noseStart, -this.noseOffset);
        for (let i = 1; i < this.noseLength; i++) this.lineTo(i+this.noseStart, -this.noseOffset - this.noseDiameter[i]*0.9);
        this.moveTo(this.noseStart+velumAngle, -this.noseOffset);
        for (let i = Math.ceil(velumAngle); i < this.noseLength; i++) this.lineTo(i+this.noseStart, -this.noseOffset);
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
        this.drawText(this.n*0.93, 0.8+0.8*this.voice.d[this.n-1], " lip"); 

        this.drawBackground();
        this.drawPositions();

    }

    drawText(i: number, d: number, text: string) {
        var angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        var r = this.radius - this.scale*d; 
        this.ctx!.save();
        this.ctx!.translate(this.originX-r*Math.cos(angle), this.originY-r*Math.sin(angle)+2); //+8);
        this.ctx!.rotate(angle-Math.PI/2);
        this.ctx!.fillText(text, 0, 0);
        this.ctx!.restore();
    }

    moveTo(i: number, d: number) {
        var angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        // var wobble = (Tract.maxAmplitude[Tract.n-1]+Tract.noseMaxAmplitude[Tract.noseLengths-1]);
        // wobble *= 0.03*Math.sin(2*i-50*time)*i/Tract.n;
        // angle += wobble;        
        var wobble = 0; //remove this line to add wobble
        var r = this.radius - this.scale*d + 100*wobble;
        var x = this.originX-r*Math.cos(angle);
        var y = this.originY-r*Math.sin(angle);
        this.ctx!.moveTo(x, y);
    }
    
    lineTo(i: number, d: number) {
        var angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        // var wobble = (Tract.maxAmplitude[Tract.n-1]+Tract.noseMaxAmplitude[Tract.noseLength-1]);
        // wobble *= 0.03*Math.sin(2*i-50*time)*i/Tract.n;
        // angle += wobble;       
        var wobble = 0; //remove this line to add wobble
        var r = this.radius - this.scale*d + 100*wobble;
        var x = this.originX-r*Math.cos(angle);
        var y = this.originY-r*Math.sin(angle);
        this.ctx!.lineTo(x, y);
    }

    drawCircle(i: number, d: number, radius: number)
    {
        var angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        var r = this.radius - this.scale*d; 
        this.ctx!.beginPath();
        this.ctx!.arc(this.originX-r*Math.cos(angle), this.originY-r*Math.sin(angle), radius, 0, 2*Math.PI);
        this.ctx!.fill();
    }

    drawAmplitudes() {
        this.ctx!.strokeStyle = "orchid";
        this.ctx!.lineCap = "butt";
        this.ctx!.globalAlpha = 0.3;
        for (let i=2; i<this.n-1; i++)
        {
            this.ctx!.beginPath();
            this.ctx!.lineWidth = 1; //Math.sqrt(Tract.maxAmplitude[i])*3;
            this.moveTo(i, 0);
            this.lineTo(i, this.voice.d![i]);
            this.ctx!.stroke();
        }
        for (let i=1; i<this.noseLength-1; i++)
        {
            this.ctx!.beginPath();
            this.ctx!.lineWidth = 1; //Math.sqrt(Tract.noseMaxAmplitude[i]) * 3;
            this.moveTo(i+this.noseStart, -this.noseOffset);
            this.lineTo(i+this.noseStart, -this.noseOffset - this.noseDiameter[i]*0.9);
            this.ctx!.stroke();
        }
        this.ctx!.globalAlpha = 1;
    }

    drawTongueControl() {
        this.ctx!.lineCap = "round";
        this.ctx!.lineJoin = "round";
        this.ctx!.strokeStyle = "#ffeef5"; //pale pink
        this.ctx!.fillStyle = "#ffeef5";
        this.ctx!.globalAlpha = 1.0;
        this.ctx!.beginPath();
        this.ctx!.lineWidth = 45;
        
        //outline
        this.moveTo(this.tongueLowerIndexBound, this.innerTongueControlRadius);
        for (let i=this.tongueLowerIndexBound+1; i<=this.tongueUpperIndexBound; i++) this.lineTo(i, this.innerTongueControlRadius);
        this.lineTo(this.tongueIndexCentre, this.outerTongueControlRadius);
        this.ctx!.closePath();
        this.ctx!.stroke();
        this.ctx!.fill();
        
        var a = this.innerTongueControlRadius;
        var c = this.outerTongueControlRadius;
        var b = 0.5*(a+c);
        var r = 3;
        this.ctx!.fillStyle = "orchid";
        this.ctx!.globalAlpha = 0.3;        
        this.drawCircle(this.tongueIndexCentre, a, r);
        this.drawCircle(this.tongueIndexCentre-4.25, a, r);
        this.drawCircle(this.tongueIndexCentre-8.5, a, r);
        this.drawCircle(this.tongueIndexCentre+4.25, a, r);
        this.drawCircle(this.tongueIndexCentre+8.5, a, r);
        this.drawCircle(this.tongueIndexCentre-6.1, b, r);    
        this.drawCircle(this.tongueIndexCentre+6.1, b, r);  
        this.drawCircle(this.tongueIndexCentre, b, r);  
        this.drawCircle(this.tongueIndexCentre, c, r);
        
        this.ctx!.globalAlpha = 1.0;         

        //circle for tongue position
        var angle = this.angleOffset + this.tongueIndex * this.angleScale * Math.PI / (this.lipStart-1);
        var r = this.radius - this.scale*(this.tongueDiameter);
        var x = this.originX-r*Math.cos(angle);
        var y = this.originY-r*Math.sin(angle);
        this.ctx!.lineWidth = 4;
        this.ctx!.strokeStyle = "orchid";
        this.ctx!.globalAlpha = 0.7;
        this.ctx!.beginPath();
        this.ctx!.arc(x,y, 18, 0, 2*Math.PI);
        this.ctx!.stroke();        
        this.ctx!.globalAlpha = 0.15;
        this.ctx!.fill();
        this.ctx!.globalAlpha = 1.0;
        
        this.ctx!.fillStyle = "orchid";
    }

    drawBackground()
    {
        
        //text
        this.ctx!.fillStyle = "black";
        this.ctx!.font="20px Arial";
        this.ctx!.textAlign = "center";
        this.ctx!.globalAlpha = 0.7;
        this.drawText(this.n*0.44, -0.28, "soft");
        this.drawText(this.n*0.51, -0.28, "palate");
        this.drawText(this.n*0.77, -0.28, "hard");
        this.drawText(this.n*0.84, -0.28, "palate");
        this.drawText(this.n*0.95, -0.28, " lip");
        
        this.ctx!.font="17px Arial";        
        this.drawTextStraight(this.n*0.18, 3, "  tongue control");   
        this.ctx!.textAlign = "left";
        this.drawText(this.n*1.03, -1.07, "nasals");
        this.drawText(this.n*1.03, -0.28, "stops");
        this.drawText(this.n*1.03, 0.51, "fricatives");
        //this.drawTextStraight(1.5, +0.8, "glottis")
        this.ctx!.strokeStyle = "orchid";
        this.ctx!.lineWidth = 2;
        this.ctx!.beginPath();
        this.moveTo(this.n*1.03, 0); this.lineTo(this.n*1.07, 0); 
        this.moveTo(this.n*1.03, -this.noseOffset); this.lineTo(this.n*1.07,  -this.noseOffset); 
        this.ctx!.stroke();
        this.ctx!.globalAlpha = 0.9;
        this.ctx!.globalAlpha = 1.0;
        // this.ctx = tractCtx;
    }

    drawTextStraight(i: number, d: number, text: string)
    {
        var angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        var r = this.radius - this.scale*d; 
        this.ctx!.save();
        this.ctx!.translate(this.originX-r*Math.cos(angle), this.originY-r*Math.sin(angle)+2); //+8);
        this.ctx!.fillText(text, 0, 0);
        this.ctx!.restore();
    }

    drawPositions()
    {
        this.ctx!.fillStyle = "orchid";
        this.ctx!.font="24px Arial";
        this.ctx!.textAlign = "center";
        this.ctx!.globalAlpha = 0.6;
        var a = 2;
        var b = 1.5;
        this.drawText(15/44*this.n, a+b*0.60, 'æ'); //pat
        this.drawText(13/44*this.n, a+b*0.27, 'ɑ'); //part
        this.drawText(12/44*this.n, a+b*0.00, 'ɒ'); //pot
        this.drawText(17.7/44*this.n, a+b*0.05, '(ɔ)'); //port (rounded)
        this.drawText(27/44*this.n, a+b*0.65, 'ɪ'); //pit
        this.drawText(27.4/44*this.n, a+b*0.21, 'i'); //peat
        this.drawText(20/44*this.n, a+b*1.00, 'e'); //pet
        this.drawText(18.1/44*this.n, a+b*0.37, 'ʌ'); //putt   
            //put ʊ
        this.drawText(23/44*this.n, a+b*0.1, '(u)'); //poot (rounded)   
        this.drawText(21/44*this.n, a+b*0.6, 'ə'); //pert [should be ɜ]
        
        var nasals = -1.1;
        var stops = -0.4;
        var fricatives = 0.5;
        var approximants = 0.9;
        this.ctx!.globalAlpha = 0.8;
        
        //approximants
        this.drawText(38/44*this.n, approximants, 'L');
        this.drawText(41/44*this.n, approximants, 'w');
        this.drawText(28.6/44*this.n, approximants, "R")
        
        //?
        this.drawText(4.5/44*this.n, 0.37, 'H');
        
        // if (this.voice.glottis.parameters.get("intensity")!.value > 0) {
            //voiced consonants
            this.drawText(33/44*this.n, fricatives, 'ʒ/ʃ');     
            this.drawText(36.5/44*this.n, fricatives, 'z/s');
            this.drawText(39.5/44*this.n, fricatives, 'v/f');
            this.drawText(22/44*this.n, stops, 'g/k');
            this.drawText(35/44*this.n, stops, 'd/t');
            this.drawText(41.5/44*this.n, stops, 'b/p');
            this.drawText(22/44*this.n, nasals, 'ŋ');
            this.drawText(35/44*this.n, nasals, 'n');
            this.drawText(41/44*this.n, nasals, 'm');  
        // } 
    }

    getIndex(x: number, y: number) {
        var xx = x-this.originX; var yy = y-this.originY;
        var angle = Math.atan2(yy, xx);
        while (angle> 0) angle -= 2*Math.PI;
        return (Math.PI + angle - this.angleOffset)*(this.lipStart-1) / (this.angleScale*Math.PI);
    }
    getDiameter(x: number, y: number)
    {
        var xx = x-this.originX; var yy = y-this.originY;
        return (this.radius-Math.sqrt(xx*xx + yy*yy))/this.scale;
    }

    startMouse(event: MouseEvent) {
        let touch: Record<string, any> = {
            alive: true,
            x: (event.pageX-this.cnv!.offsetLeft)/this.cnv!.getBoundingClientRect().width*600,
            y: (event.pageY-this.cnv!.offsetTop)/this.cnv!.getBoundingClientRect().width*600
        };

        touch.index = this.getIndex(touch.x, touch.y);
        touch.diameter = this.getDiameter(touch.x, touch.y);

        if (touch.index >= this.tongueLowerIndexBound-4 && touch.index<=this.tongueUpperIndexBound+4 
            && touch.diameter >= this.innerTongueControlRadius-0.5 && touch.diameter <= this.outerTongueControlRadius+0.5)
        {
            this.tongueTouch = touch;
        }

        this.mouseTouch = touch;
        this.touchesWithMouse.push(touch);   
        this.handleTouches();
    }

    endMouse()
    {
        let touch = this.mouseTouch;
        if (!touch.alive) return;
        touch.alive = false;
        this.handleTouches();
    }

    moveMouse(event: MouseEvent)
    {
        let touch = this.mouseTouch;
        if (!touch.alive) return;
        touch.x = (event.pageX-this.cnv!.offsetLeft)/this.cnv!.getBoundingClientRect().width*600;
        touch.y = (event.pageY-this.cnv!.offsetTop)/this.cnv!.getBoundingClientRect().width*600;
        touch.index = this.getIndex(touch.x, touch.y);
        touch.diameter = this.getDiameter(touch.x, touch.y); 
        this.handleTouches();
    }

    handleTouches() {

        let index, diameter;

        if (this.tongueTouch && !this.tongueTouch.alive) this.tongueTouch = undefined;

        if (this.tongueTouch && !this.ignoreTongue) {
            var x = this.tongueTouch.x;
            var y = this.tongueTouch.y;        
            index = this.getIndex(x,y);
            diameter = this.getDiameter(x,y);
            var fromPoint = (this.outerTongueControlRadius-diameter)/(this.outerTongueControlRadius-this.innerTongueControlRadius);
            fromPoint = constrain(fromPoint, 0, 1);
            fromPoint = Math.pow(fromPoint, 0.58) - 0.2*(fromPoint*fromPoint-fromPoint); //horrible kludge to fit curve to straight line
            this.tongueDiameter = constrain(diameter, this.innerTongueControlRadius, this.outerTongueControlRadius);
            this.tongueIndex = constrain(index, this.tongueLowerIndexBound, this.tongueUpperIndexBound);
            var out = fromPoint*0.5*(this.tongueUpperIndexBound-this.tongueLowerIndexBound);
            this.tongueIndex = constrain(index, this.tongueIndexCentre-out, this.tongueIndexCentre+out);

            this.voice.tongue = {i: this.tongueIndex, d: this.tongueDiameter};
            this.voice.tract.parameters.get("tongue-index")!.value = this.tongueIndex;
            this.voice.tract.parameters.get("tongue-diameter")!.value = this.tongueDiameter;
        }

        if (!this.recording) this.setRestDiameter();   

        const targets = [...this.restDiameter]
        this.voice.tract.parameters.get('velum-target')!.value = 0.01

        for (let j=0; j<this.touchesWithMouse.length; j++) {
            var touch = this.touchesWithMouse[j];
            if (!touch.alive) continue;            
            var x = touch.x;
            var y = touch.y;
            index = this.getIndex(x,y);
            diameter = this.getDiameter(x,y);

            if (index > this.noseStart && diameter < -this.noseOffset)     
                this.voice.tract.parameters.get('velum-target')!.value = 0.4;      
            if (diameter < -0.85-this.noseOffset) continue;
            diameter -= 0.3;
            if (diameter<0) diameter = 0;       
            this.voice.constriction = index != undefined ? {i: index, d: diameter!} : undefined;  
            var width=2;
            if (index<25) width = 10;
            else if (index>=this.tipStart) width= 5;
            else width = 10-5*(index-25)/(this.tipStart-25);
            if (index >= 2 && index < this.n && y<this.cnv!.height && diameter < 3)
            {
                let intIndex = Math.round(index);
                for (let i=-Math.ceil(width)-1; i<width+1; i++) 
                {   
                    if (intIndex+i<0 || intIndex+i>=this.n) continue;
                    var relpos = (intIndex+i) - index;
                    relpos = Math.abs(relpos)-0.5;
                    var shrink;
                    if (relpos <= 0) shrink = 0;
                    else if (relpos > width) shrink = 1;
                    else shrink = 0.5*(1-Math.cos(Math.PI * relpos / width));
                    if (diameter < targets[intIndex+i])
                    {
                        targets[intIndex+i] = diameter + (targets[intIndex+i]-diameter)*shrink;
                    }
                }
            }
        }
        

        this.voice.tract.parameters.get('constriction-index')!.value = index || 0;
        this.voice.tract.parameters.get('constriction-diameter')!.value = diameter || 0;

        this.voice.tract.parameters.get('fricative-strength')!.value = 1;
    }
    
}

function constrain(n: number, low: number, high: number): number {
    return Math.max(Math.min(n, high), low);
};
