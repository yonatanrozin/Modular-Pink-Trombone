import { useEffect, useRef, useState } from "react";
import RPTProcessors from "./processors.ts?worker&url";

export async function addRPT(ctx: AudioContext) {
    await ctx.audioWorklet.addModule(RPTProcessors);
}

export type RPTTractMessageData = {
    diameters?: Float64Array,
    velum?: number
}

export default class RPT {

    audioContext: AudioContext;

    protected whiteNoise: AudioBufferSourceNode;
    protected aspirationFilter: BiquadFilterNode;
    protected fricativeFilter: BiquadFilterNode;
    protected glottis: RPTGlottisNode;
    protected tract: RPTTractNode;
    protected gainNode: GainNode;

    connected = false;

    get frequency() { return this.glottis.frequency; }
    get tenseness() { return this.glottis.tenseness; }
    get tensenessScale() { return this.glottis.tensenessScale; }
    get intensity() { return this.glottis.intensity; }
    
    get tractN() { return this.tract.n; }
    get tongueIndex() { return this.tract.tongueIndex; }
    get tongueDiameter() { return this.tract.tongueDiameter; }
    get constrictionIndex() { return this.tract.constrictionIndex; }
    get constrictionDiameter() { return this.tract.constrictionDiameter; }
    get velumTarget() { return this.tract.velumTarget; }
    get movementSpeed() { return this.tract.movementSpeed; }

    get gain() { return this.gainNode.gain; }
    get diameters() { return this.tract.diameters; }
    get velum() { return this.tract.velum; }
    
    constructor(ctx: AudioContext, autoConstrictions: boolean = true) {
        this.audioContext = ctx;
        this.whiteNoise = this.getWhiteNoiseSource(ctx);
        this.aspirationFilter = this.getAspirationFilter(ctx);
        this.fricativeFilter = this.getFricativeFilter(ctx);
        this.glottis = new RPTGlottisNode(ctx);
        this.tract = new RPTTractNode(ctx, autoConstrictions);
        this.gainNode = new GainNode(ctx);
        this.whiteNoise.start();
        this.connect(ctx.destination);
    }

    connect(destination: AudioNode) {
        this.disconnect();
        this.whiteNoise.connect(this.aspirationFilter);
        this.aspirationFilter.connect(this.glottis);
        this.aspirationFilter.connect(this.tract, 0, 1);
        this.whiteNoise.connect(this.fricativeFilter);
        this.fricativeFilter.connect(this.glottis);
        this.fricativeFilter.connect(this.tract, 0, 1);
        this.glottis.connect(this.tract, 0, 0);
        this.glottis.connect(this.tract, 1, 2);
        this.glottis.connect(this.tract, 2, 3);
        this.tract.connect(this.gainNode);
        this.gainNode.connect(destination);
        this.connected = true;
    }

    disconnect() {
        this.whiteNoise.disconnect();
        this.aspirationFilter.disconnect();
        this.fricativeFilter.disconnect();
        this.glottis.disconnect();
        this.tract.disconnect();
        this.gainNode.disconnect();
        this.connected = false;
    }

    UIComponent = () => this.tract.UIComponent({glottis: this.glottis});

    private getWhiteNoiseSource(ctx: AudioContext): AudioBufferSourceNode {
        const whiteNoise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const samples = whiteNoise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random();
        const source = ctx.createBufferSource();
        source.buffer = whiteNoise;
        source.loop = true;
        return source;
    }

    private getAspirationFilter(ctx: AudioContext): BiquadFilterNode {
        const aspirateFilter = ctx.createBiquadFilter();
        aspirateFilter.type = "bandpass";
        aspirateFilter.frequency.value = 500;
        aspirateFilter.Q.value = 0.5;
        return aspirateFilter;
    }

    private getFricativeFilter(ctx: AudioContext): BiquadFilterNode {
        const fricativeFilter = ctx.createBiquadFilter();
        fricativeFilter.type = "bandpass";
        fricativeFilter.frequency.value = 1000;
        fricativeFilter.Q.value = 0.5;
        return fricativeFilter;
    }
}

export class RPTGlottisNode extends AudioWorkletNode {

    get frequency() { return this.parameters.get("frequency")! }
    get tenseness() { return this.parameters.get("tenseness")! }
    get tensenessScale() { return this.parameters.get("tenseness-scale")! }
    get intensity() { return this.parameters.get("intensity")! }

    constructor(ctx: AudioContext) {
        super(ctx, "glottis-processor", {
            numberOfOutputs: 3, //glottal signal, noise modulator, intensity
            outputChannelCount: [1, 1, 1],
        });
    }
}

export class RPTTractNode extends AudioWorkletNode {

    diameters?: Float64Array;
    velum?: number;

    get n() { return this.parameters.get("n")! }
    get tongueIndex() { return this.parameters.get("tongue-index")! }
    get tongueDiameter() { return this.parameters.get("tongue-diameter")! }
    get constrictionIndex() { return this.parameters.get("constriction-index")! }
    get constrictionDiameter() { return this.parameters.get("constriction-diameter")! }
    get velumTarget() { return this.parameters.get("velum-target")! }
    get movementSpeed() { return this.parameters.get("movement-speed")! }

    constructor(ctx: AudioContext, autoConstrictions: boolean = true) {
        super(ctx, "tract-processor", {
            numberOfInputs: 4, //glottal signal, white noise, noise modulator, glottis intensity
            processorOptions: {autoConstrictions}
        });
        this.port.start();
        this.port.onmessage = this.onPortMessage;
    }   

    setDiameters(diameters: ArrayLike<number>) {
        this.port.postMessage({diameters});
    }

    UIComponent = (props: {glottis?: RPTGlottisNode}) => {

        const {glottis} = props;
        const [UI, setUI] = useState<RPTTractUI>();
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const animationFrame = useRef<number>();

        useEffect(() => { setUI(new RPTTractUI(this, glottis)); }, [this]);

        useEffect(() => {
            if (!canvasRef.current || !UI) return;
            UI.cnv = canvasRef.current;
            UI.ctx = canvasRef.current.getContext("2d")!;
            (function loop() {
                UI!.draw();
                animationFrame.current = requestAnimationFrame(loop);
            })();
            return () => { cancelAnimationFrame(animationFrame.current!); }
        }, [canvasRef, UI]);

        if (UI) return <canvas ref={canvasRef} width={600} height={glottis ? 700 : 600} className="RPT-tract-canvas"
            onMouseDown={UI.startMouse} onMouseUp={UI.endMouse} onMouseMove={UI.moveMouse} 
        />
    }

    private onPortMessage = ({data}: MessageEvent<RPTTractMessageData>) => {
        if (data.diameters) this.diameters = data.diameters;
        if (data.velum) this.velum = data.velum;
    }
}

type RPTTouch = {
    x: number, y: number, alive: boolean,
    index: number, diameter: number
}

const palePink = "#ffeef5";

export class RPTTractUI {
    ctx?: CanvasRenderingContext2D; 
    cnv?: HTMLCanvasElement;

    tract: RPTTractNode; 
    glottis?: RPTGlottisNode;

    originX = 340;
    originY = 500; 
    radius = 298; 
    scale = 70;
    innerTongueControlRadius = 2.05;
    outerTongueControlRadius = 3.5;
    tongueTouch?: RPTTouch;
    keyboardTouch?: RPTTouch;
    angleScale = 0.64;
    angleOffset = -0.24;
    noseOffset = 0.8;
    gridOffset = 1.7;
    fillColour = 'pink';
    lineColour = '#C070C6';

    keyboardTop = 600;
    keyboardLeft = 0;
    keyboardWidth = 600;
    keyboardHeight = 100;
    semitones = 20;
    marks = [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0];
    baseNote = 87.3071;

    get n () { return this.tract.n.value; }
    get tongueIndex() { return this.tract.tongueIndex.value; }
    get tongueDiameter() { return this.tract.tongueDiameter.value; }
    get diameters() { return this.tract.diameters; }

    get bladeStart() { return Math.floor(10 * this.n / 44); }
    get lipStart() { return Math.floor(39 * this.n / 44); }
    get tipStart() { return Math.floor(32 * this.n / 44); }

    get noseLength() { return Math.floor(28 * this.n / 44); }
    get noseStart() { return this.n - this.noseLength + 1; }

    get tongueLowerIndexBound() { return this.bladeStart + 2; }
    get tongueUpperIndexBound() { return this.tipStart - 3; }
    get tongueIndexCentre() { return 0.5*(this.tongueLowerIndexBound+this.tongueUpperIndexBound); }

    noseDiameter!: Float64Array;

    mouseTouch: RPTTouch = {x: 0, y: 0, alive: false, index: 0, diameter: 0};
    touchesWithMouse: RPTTouch[] = [];

    constructor(tract: RPTTractNode, glottis?: RPTGlottisNode) {
        this.glottis = glottis;
        this.tract = tract;
        this.init();
    }

    init() {
        const n = this.n;
        
        const newDiameters = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            newDiameters[i] = 0;
            if (i < 7*n/44 - 0.5) newDiameters[i] = 0.6;
            else if (i < 12*n/44) newDiameters[i] = 1.1;
            else newDiameters[i] = 1.5;
        }
        
        this.noseDiameter = new Float64Array(this.noseLength);
        for (let i = 0; i < this.noseLength; i++) {
            let diameter;
            let d = 2 * (i / this.noseLength);
            if (d < 1) diameter = 0.4 + 1.6 * d;
            else diameter = 0.5 + 1.5 * (2 - d);
            diameter = Math.min(diameter, 1.9);
            this.noseDiameter[i] = diameter;
        }
        this.tract.diameters = newDiameters;
    }

    tongueIndexFromNormalized(i: number = this.tongueIndex) {
        return this.tongueLowerIndexBound + i * 
            (this.tongueUpperIndexBound - this.tongueLowerIndexBound)
    }

    normalizedTongueIndex(index: number) {
        return (index - this.tongueLowerIndexBound) /
            (this.tongueUpperIndexBound - this.tongueLowerIndexBound);
    }

    draw() {

        if (!this.ctx || !this.tract.diameters || typeof this.tract.velum !== "number") return;

        this.ctx!.clearRect(0, 0, this.ctx!.canvas.width, this.ctx!.canvas.height);

        this.ctx!.lineCap = 'round';        
        this.ctx!.lineJoin = 'round';  
        
        this.drawTongueControl();
        
        let velum = this.tract.velum;
        let velumAngle = velum * 4;
        
        //first draw fill
        this.ctx!.beginPath();        
        this.ctx!.lineWidth = 2;
        this.ctx!.strokeStyle = this.fillColour;
        this.ctx!.fillStyle = this.fillColour;

        const n = this.n;

        this.moveTo(1,0);

        for (let i = 1; i < n; i++) this.lineTo(i, this.tract.diameters[i]);
        for (let i = n - 1; i >= 2; i--) this.lineTo(i, 0);  

        this.ctx!.closePath();
        this.ctx!.stroke();
        this.ctx!.fill();
        
        //for nose
        this.ctx!.beginPath();        
        this.ctx!.lineWidth = 2;
        this.ctx!.strokeStyle = this.fillColour;
        this.ctx!.fillStyle = this.fillColour;
        this.moveTo(this.noseStart, -this.noseOffset);
        for (let i = 1; i < this.noseLength; i++) this.lineTo(i+this.noseStart, -this.noseOffset - this.noseDiameter[i]*0.9);
        for (let i = this.noseLength-1; i >= 1; i--) this.lineTo(i+this.noseStart, -this.noseOffset);  
        this.ctx!.closePath();
        this.ctx!.stroke();
        this.ctx!.fill();

        //velum
        this.ctx!.beginPath();
        this.ctx!.lineWidth = 2;
        this.ctx!.strokeStyle = this.fillColour;
        this.ctx!.fillStyle = this.fillColour;
        this.moveTo(this.noseStart-2, 0);
        this.lineTo(this.noseStart, -this.noseOffset);
        this.lineTo(this.noseStart+velumAngle, -this.noseOffset);
        this.lineTo(this.noseStart+velumAngle-2, 0);
        this.ctx!.closePath();
        this.ctx!.stroke();
        this.ctx!.fill();

        //white text
        this.ctx!.fillStyle = "white";
        this.ctx!.font="20px Arial";
        this.ctx!.textAlign = "center";
        this.ctx!.globalAlpha = 1.0;
        this.drawText(n * 0.10, 0.425, "throat");         
        this.drawText(n * 0.71, -1.8, "nasal");
        this.drawText(n * 0.71, -1.3, "cavity");
        this.ctx!.font="22px Arial";        
        this.drawText(n * 0.64, 1.1, "oral");    
        this.drawText(n * 0.74, 1.1, "cavity"); 

        this.drawAmplitudes(); 

        //then draw lines
        this.ctx!.beginPath();        
        this.ctx!.lineWidth = 5;
        this.ctx!.strokeStyle = this.lineColour;
        this.ctx!.lineJoin = 'round';
        this.ctx!.lineCap = 'round';          
        this.moveTo(1, this.tract.diameters[0]);
        for (let i = 2; i < n; i++) this.lineTo(i, this.tract.diameters[i]);
        this.moveTo(1,0);
        for (let i = 2; i <= this.noseStart-2; i++) this.lineTo(i, 0);
        this.moveTo(this.noseStart+velumAngle-2,0);
        for (let i = this.noseStart+Math.ceil(velumAngle)-2; i < n; i++) this.lineTo(i, 0);   
        this.ctx!.stroke();

        //for nose
        this.ctx!.beginPath();        
        this.ctx!.lineWidth = 5;
        this.ctx!.strokeStyle = this.lineColour;
        this.ctx!.lineJoin = 'round';  
        this.moveTo(this.noseStart, -this.noseOffset);
        for (let i = 1; i < this.noseLength; i++) this.lineTo(i+this.noseStart, -this.noseOffset - this.noseDiameter[i]*0.9);
        this.moveTo(this.noseStart+velumAngle, -this.noseOffset);
        for (let i = Math.ceil(velumAngle); i < this.noseLength; i++) this.lineTo(i+this.noseStart, -this.noseOffset);
        this.ctx!.stroke();
                
        //velum
        this.ctx!.globalAlpha = velum*5;
        this.ctx!.beginPath();
        this.moveTo(this.noseStart-2, 0);
        this.lineTo(this.noseStart, -this.noseOffset);
        this.moveTo(this.noseStart+velumAngle-2, 0);
        this.lineTo(this.noseStart+velumAngle, -this.noseOffset);  
        this.ctx!.stroke();
        
        this.ctx!.fillStyle = "orchid";
        this.ctx!.font="20px Arial";
        this.ctx!.textAlign = "center";
        this.ctx!.globalAlpha = 0.7;
        this.drawText(n*0.93, 0.8+0.8*this.tract.diameters[n-1], " lip"); 

        this.drawCircle(this.tract.constrictionIndex.value * this.n, this.tract.constrictionDiameter.value, 10)
        this.drawBackground();
        this.drawKeyboard();
        this.drawPitchControl();
        this.drawPositions();
    }

    drawText(i: number, d: number, text: string) {
        if (!this.ctx) return;
        let angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        let r = this.radius - this.scale*d; 
        this.ctx!.save();
        this.ctx!.translate(this.originX-r*Math.cos(angle), this.originY-r*Math.sin(angle)+2); //+8);
        this.ctx!.rotate(angle-Math.PI/2);
        this.ctx!.fillText(text, 0, 0);
        this.ctx!.restore();
    }

    moveTo(i: number, d: number) {
        if (!this.ctx) return;
        let angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        // let wobble = (Tract.maxAmplitude[Tract.n-1]+Tract.noseMaxAmplitude[Tract.noseLengths-1]);
        // wobble *= 0.03*Math.sin(2*i-50*time)*i/Tract.n;
        // angle += wobble;        
        let wobble = 0; //remove this line to add wobble
        let r = this.radius - this.scale*d + 100*wobble;
        let x = this.originX-r*Math.cos(angle);
        let y = this.originY-r*Math.sin(angle);
        this.ctx!.moveTo(x, y);
    }
    
    lineTo(i: number, d: number) {
        if (!this.ctx) return;
        let angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);   
        let wobble = 0; 
        let r = this.radius - this.scale*d + 100*wobble;
        let x = this.originX-r*Math.cos(angle);
        let y = this.originY-r*Math.sin(angle);
        this.ctx!.lineTo(x, y);
    }

    drawCircle(i: number, d: number, radius: number) {
        if (!this.ctx) return;
        let angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        let r = this.radius - this.scale*d; 
        this.ctx!.beginPath();
        this.ctx!.arc(this.originX-r*Math.cos(angle), this.originY-r*Math.sin(angle), radius, 0, 2*Math.PI);
        this.ctx!.fill();
    }

    drawAmplitudes() {
        if (!this.ctx) return;
        this.ctx!.strokeStyle = "orchid";
        this.ctx!.lineCap = "butt";
        this.ctx!.globalAlpha = 0.3;

        const n = this.n;
        for (let i = 2; i < n-1; i++) {
            this.ctx!.beginPath();
            this.ctx!.lineWidth = 1; //Math.sqrt(Tract.maxAmplitude[i])*3;
            this.moveTo(i, 0);
            this.lineTo(i, this.tract.diameters![i]);
            this.ctx!.stroke();
        }
        for (let i=1; i<this.noseLength-1; i++) {
            this.ctx!.beginPath();
            this.ctx!.lineWidth = 1; //Math.sqrt(Tract.noseMaxAmplitude[i]) * 3;
            this.moveTo(i+this.noseStart, -this.noseOffset);
            this.lineTo(i+this.noseStart, -this.noseOffset - this.noseDiameter[i]*0.9);
            this.ctx!.stroke();
        }
        this.ctx!.globalAlpha = 1;
    }

    drawTongueControl() {
        if (!this.ctx) return;

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
        
        let a = this.innerTongueControlRadius;
        let c = this.outerTongueControlRadius;
        let b = 0.5*(a+c);
        let r = 3;
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
        let angle = this.angleOffset + this.tongueIndexFromNormalized() 
            * this.angleScale * Math.PI / (this.lipStart-1);
        r = this.radius - this.scale*(this.tongueDiameter);
        let x = this.originX-r*Math.cos(angle);
        let y = this.originY-r*Math.sin(angle);
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

    drawPitchControl() {
        if (!this.glottis) return;
        const w=9;
        const h=15;
        
        //inversion of setting UIFrequency, UITenseness, Glottis.x and Glottis.y from keyboard touch location
        const semitone = 12 * Math.log2(this.glottis.frequency.value / this.baseNote);
        const x = (semitone - 0.5) * this.keyboardWidth / this.semitones + this.keyboardLeft;
        const t = Math.acos(1 - this.glottis.tenseness.value) / (Math.PI * 0.5);
        const y = (1 - t) * (this.keyboardHeight - 28) + this.keyboardTop + 10 - 100;

        this.ctx!.lineWidth = 4;
        this.ctx!.strokeStyle = "orchid";
        this.ctx!.globalAlpha = 0.7;
        this.ctx!.beginPath();
        this.ctx!.moveTo(x - w, y - h + 100);
        this.ctx!.lineTo(x + w, y - h + 100);
        this.ctx!.lineTo(x + w, y + h + 100);
        this.ctx!.lineTo(x - w, y + h + 100);                    
        this.ctx!.closePath();            
        this.ctx!.stroke();    
        this.ctx!.globalAlpha = 0.15;
        this.ctx!.fill();            
        this.ctx!.globalAlpha = 1.0;
    }

    drawKeyboard() {      
        this.ctx!.strokeStyle = palePink;
        this.ctx!.fillStyle = palePink;        
        this.ctx!.globalAlpha = 1.0;     
        this.ctx!.lineCap = 'round';        
        this.ctx!.lineJoin = 'round';        
            
        this.drawBar(0.0, 0.4, 8);
        this.ctx!.globalAlpha = 0.7;         
        this.drawBar(0.52, 0.72, 8);
        
        this.ctx!.strokeStyle = "orchid";   
        this.ctx!.fillStyle = "orchid";
        for (let i=0; i< this.semitones; i++) {
            const keyWidth = this.keyboardWidth/this.semitones;
            const x = this.keyboardLeft+(i+1/2)*keyWidth;
            const y = this.keyboardTop;
            if (this.marks[(i+3)%12]==1) {
                this.ctx!.lineWidth = 4;
                this.ctx!.globalAlpha = 0.4;  
            }
            else {
                this.ctx!.lineWidth = 3;
                this.ctx!.globalAlpha = 0.2;  
            }
            this.ctx!.beginPath();
            this.ctx!.moveTo(x,y+9);
            this.ctx!.lineTo(x, y+this.keyboardHeight*0.4-9);
            this.ctx!.stroke();
            
            this.ctx!.lineWidth = 3;
            this.ctx!.globalAlpha = 0.15;   
            
            this.ctx!.beginPath();
            this.ctx!.moveTo(x,y+this.keyboardHeight*0.52+6);
            this.ctx!.lineTo(x, y+this.keyboardHeight*0.72-6);
            this.ctx!.stroke();  
          
        }
        
        this.ctx!.fillStyle = "orchid";
        this.ctx!.font="17px Arial";
        this.ctx!.textAlign = "center";
        this.ctx!.globalAlpha = 0.7; 
        this.ctx!.fillText("voicebox control", 300, 490 + 100); //+100 to move above keyboard
        this.ctx!.fillText("pitch", 300, 592 + 100);
        this.ctx!.globalAlpha = 0.3; 
        this.ctx!.strokeStyle = "orchid";
        this.ctx!.fillStyle = "orchid";  
        this.ctx!.save()
        this.ctx!.translate(410, 587 + 100);
        this.drawArrow(80, 2, 10);
        this.ctx!.translate(-220, 0);
        this.ctx!.rotate(Math.PI);
        this.drawArrow(80, 2, 10);
        this.ctx!.restore(); 
        this.ctx!.globalAlpha=1.0;        
    }

    drawBar(topFactor: number, bottomFactor: number, radius: number) {
        this.ctx!.lineWidth = radius*2; 
        this.ctx!.beginPath();
        this.ctx!.moveTo(this.keyboardLeft+radius, this.keyboardTop+topFactor*this.keyboardHeight+radius);
        this.ctx!.lineTo(this.keyboardLeft+this.keyboardWidth-radius, this.keyboardTop+topFactor*this.keyboardHeight+radius);
        this.ctx!.lineTo(this.keyboardLeft+this.keyboardWidth-radius, this.keyboardTop+bottomFactor*this.keyboardHeight-radius);
        this.ctx!.lineTo(this.keyboardLeft+radius, this.keyboardTop+bottomFactor*this.keyboardHeight-radius);
        this.ctx!.closePath();
        this.ctx!.stroke();
        this.ctx!.fill();
    }

    drawArrow(l: number, ahw: number, ahl: number) {
        this.ctx!.lineWidth = 2;
        this.ctx!.beginPath();
        this.ctx!.moveTo(-l, 0);
        this.ctx!.lineTo(0,0);
        this.ctx!.lineTo(0, -ahw);
        this.ctx!.lineTo(ahl, 0);
        this.ctx!.lineTo(0, ahw);
        this.ctx!.lineTo(0,0);
        this.ctx!.closePath();
        this.ctx!.stroke();
        this.ctx!.fill();
    }

    drawBackground() {
        if (!this.ctx) return;

        const n = this.n;
        
        //text
        this.ctx!.fillStyle = "black";
        this.ctx!.font="20px Arial";
        this.ctx!.textAlign = "center";
        this.ctx!.globalAlpha = 0.7;
        this.drawText(n * 0.44, -0.28, "soft");
        this.drawText(n * 0.51, -0.28, "palate");
        this.drawText(n * 0.77, -0.28, "hard");
        this.drawText(n * 0.84, -0.28, "palate");
        this.drawText(n * 0.95, -0.28, " lip");
        
        this.ctx!.font="17px Arial";        
        this.drawTextStraight(n * 0.18, 3, "  tongue control");   
        this.ctx!.textAlign = "left";
        this.drawText(n * 1.03, -1.07, "nasals");
        this.drawText(n * 1.03, -0.28, "stops");
        this.drawText(n * 1.03, 0.51, "fricatives");
        this.drawTextStraight(1.5, +0.8, "glottis")
        this.ctx!.strokeStyle = "orchid";
        this.ctx!.lineWidth = 2;
        this.ctx!.beginPath();
        this.moveTo(n * 1.03, 0); this.lineTo(n * 1.07, 0); 
        this.moveTo(n * 1.03, -this.noseOffset); this.lineTo(n * 1.07,  -this.noseOffset); 
        this.ctx!.stroke();
        this.ctx!.globalAlpha = 0.9;
        this.ctx!.globalAlpha = 1.0;
    }

    drawTextStraight(i: number, d: number, text: string)
    {
        if (!this.ctx) return;

        let angle = this.angleOffset + i * this.angleScale * Math.PI / (this.lipStart-1);
        let r = this.radius - this.scale*d; 
        this.ctx!.save();
        this.ctx!.translate(this.originX-r*Math.cos(angle), this.originY-r*Math.sin(angle)+2); //+8);
        this.ctx!.fillText(text, 0, 0);
        this.ctx!.restore();
    }

    drawPositions() {
        if (!this.ctx) return;

        const n = this.n;

        this.ctx!.fillStyle = "orchid";
        this.ctx!.font="24px Arial";
        this.ctx!.textAlign = "center";
        this.ctx!.globalAlpha = 0.6;
        let a = 2;
        let b = 1.5;

        this.drawText(15/44 * n, a+b*0.60, 'æ'); //pat
        this.drawText(13/44 * n, a+b*0.27, 'ɑ'); //part
        this.drawText(12/44 * n, a+b*0.00, 'ɒ'); //pot
        this.drawText(17.7/44 * n, a+b*0.05, '(ɔ)'); //port (rounded)
        this.drawText(27/44 * n, a+b*0.65, 'ɪ'); //pit
        this.drawText(27.4/44 * n, a+b*0.21, 'i'); //peat
        this.drawText(20/44 * n, a+b*1.00, 'e'); //pet
        this.drawText(18.1/44 * n, a+b*0.37, 'ʌ'); //putt   
        //put ʊ
        this.drawText(23/44 * n, a+b*0.1, '(u)'); //poot (rounded)   
        this.drawText(21/44 * n, a+b*0.6, 'ə'); //pert [should be ɜ]
        
        let nasals = -1.1;
        let stops = -0.4;
        let fricatives = 0.5;
        let approximants = 0.9;
        this.ctx!.globalAlpha = 0.8;
        
        //approximants
        this.drawText(38/44 * n, approximants, 'L');
        this.drawText(41/44 * n, approximants, 'w');
        this.drawText(28.6/44 * n, approximants, "R")
        
        //?
        this.drawText(4.5/44 * n, 0.37, 'H');
        
        //voiced consonants
        this.drawText(33/44 * n, fricatives, 'ʒ/ʃ');     
        this.drawText(36.5/44 * n, fricatives, 'z/s');
        this.drawText(39.5/44 * n, fricatives, 'v/f');
        this.drawText(22/44 * n, stops, 'g/k');
        this.drawText(35/44 * n, stops, 'd/t');
        this.drawText(41.5/44 * n, stops, 'b/p');
        this.drawText(22/44 * n, nasals, 'ŋ');
        this.drawText(35/44 * n, nasals, 'n');
        this.drawText(41/44 * n, nasals, 'm');  

    }

    getIndex(x: number, y: number) {
        let xx = x-this.originX; let yy = y-this.originY;
        let angle = Math.atan2(yy, xx);
        while (angle> 0) angle -= 2*Math.PI;
        return (Math.PI + angle - this.angleOffset)*(this.lipStart-1) / (this.angleScale*Math.PI);
    }

    getDiameter(x: number, y: number)
    {
        let xx = x-this.originX; let yy = y-this.originY;
        return (this.radius-Math.sqrt(xx*xx + yy*yy))/this.scale;
    }

    startMouse = (event: React.MouseEvent) => {
        event.preventDefault();
        const {width, height} = this.cnv!.getBoundingClientRect();
        const x = event.nativeEvent.offsetX/width *this.cnv!.width;
        const y = event.nativeEvent.offsetY/height*this.cnv!.height;
        let touch: RPTTouch = {
            x, y, alive: true,
            index: this.getIndex(x, y),
            diameter: this.getDiameter(x, y)
        };
        if (touch.index >= this.tongueLowerIndexBound - 4 && 
            touch.index <= this.tongueUpperIndexBound + 4 && 
            touch.diameter >= this.innerTongueControlRadius - 0.5 && 
            touch.diameter <= this.outerTongueControlRadius + 0.5
        ) this.tongueTouch = touch;
        if (touch.y > 550) this.keyboardTouch = touch;
        this.mouseTouch = touch;
        this.touchesWithMouse.push(touch);   
        this.handleTouches();
    }

    endMouse = () => {
        let touch = this.mouseTouch;
        if (!touch.alive) return;
        touch.alive = false;
        this.handleTouches();
    }

    moveMouse = (event: React.MouseEvent) => {
        event.preventDefault();
        const {width, height} = this.cnv!.getBoundingClientRect();
        let touch = this.mouseTouch;
        if (!touch.alive) return;
        touch.x = event.nativeEvent.offsetX/width *this.cnv!.width,
        touch.y = event.nativeEvent.offsetY/height*this.cnv!.height
        touch.index = this.getIndex(touch.x, touch.y);
        touch.diameter = this.getDiameter(touch.x, touch.y); 
        this.handleTouches();
    }

    handleTouches() {

        if (this.tongueTouch && !this.tongueTouch.alive) this.tongueTouch = undefined;
        if (this.keyboardTouch && !this.keyboardTouch.alive) this.keyboardTouch = undefined;

        if (this.glottis && this.keyboardTouch) { //keyboard is touched
            const touch = this.keyboardTouch;
            const local_y = constrain(touch.y - this.keyboardTop-10, 0, this.keyboardHeight-26);
            const local_x = touch.x - this.keyboardLeft;
            const semitone = this.semitones * local_x / this.keyboardWidth + 0.5;
            this.glottis.frequency.value = this.baseNote * Math.pow(2, semitone/12);
            const t = constrain(1-local_y / (this.keyboardHeight-28), 0, 1);
            this.glottis.tenseness.value = 1 - Math.cos(t*Math.PI*0.5);
            // x = touch.x;
            // y = local_y + this.keyboardTop+10 - 100;
            return;
        }

        if (this.tongueTouch) {
            let {index, diameter} = this.tongueTouch;      
            let fromPoint = (this.outerTongueControlRadius-diameter)/(this.outerTongueControlRadius-this.innerTongueControlRadius);
            fromPoint = constrain(fromPoint, 0, 1);
            fromPoint = Math.pow(fromPoint, 0.58) - 0.2*(fromPoint*fromPoint-fromPoint); //horrible kludge to fit curve to straight line
            let tongueDiameter = constrain(diameter, this.innerTongueControlRadius, this.outerTongueControlRadius);
            let tongueIndex = constrain(index, this.tongueLowerIndexBound, this.tongueUpperIndexBound);
            let out = fromPoint*0.5*(this.tongueUpperIndexBound-this.tongueLowerIndexBound);
            tongueIndex = constrain(index, this.tongueIndexCentre-out, this.tongueIndexCentre+out);
            this.tract.tongueIndex.value = this.normalizedTongueIndex(tongueIndex);
            this.tract.tongueDiameter.value = tongueDiameter;
        }


        this.tract.velumTarget.value = 0.01
        let index, diameter;
        for (let j=0; j<this.touchesWithMouse.length; j++) {
            let touch = this.touchesWithMouse[j];
            if (!touch.alive) continue;  
            index = touch.index;
            diameter = touch.diameter;
            if (index > this.noseStart && diameter < -this.noseOffset)     
                this.tract.velumTarget.value = 0.4;      
            if (diameter < -0.85-this.noseOffset) continue;
            diameter -= 0.3;
            if (diameter < 0) diameter = 0;  
        }

        this.tract.constrictionIndex.value = index ? index/this.n : 0;
        this.tract.constrictionDiameter!.value = diameter || 0;
        // this.voice.fricativeIntensity!.value = 1;
    }
}

export function constrain(n: number, low: number, high: number): number {
    return Math.max(Math.min(n, high), low);
};