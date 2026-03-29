import { linear } from "everpolate";
import Noise from "./noise.ts";

type AudioParamDescriptor = {
    name: string;
    defaultValue: number;
    minValue?: number;
    maxValue?: number;
    automationRate?: "a-rate" | "k-rate";
}

const PT_DEFAULT_FREQ = 140;
const PT_DEFAULT_TENSENESS = 0.6;

class GlottisProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() : AudioParamDescriptor[] {
        return [
            {
                name: "frequency",
                defaultValue: PT_DEFAULT_FREQ,
                minValue: 20,
                automationRate: "a-rate"
            },
            {
                name: "tenseness",
                defaultValue: PT_DEFAULT_TENSENESS,
                minValue: 0,
                maxValue: 1,
                automationRate: "k-rate"
            },
            {
                name: "tenseness-scale",
                defaultValue: 1,
                minValue: 0,
                maxValue: 1,
                automationRate: "a-rate"
            },
            {
                name: "intensity",
                defaultValue: 1,
                minValue: 0,
                maxValue: 1,
                automationRate: "a-rate"
            },
            {
                name: "pitchbend",
                defaultValue: 0,
                automationRate: "a-rate"
            }
        ]
    }

    UIFrequency: number = PT_DEFAULT_FREQ;
    smoothFrequency: number = PT_DEFAULT_FREQ;
    frequency: number = PT_DEFAULT_FREQ;
    oldFrequency: number = PT_DEFAULT_FREQ;
    newFrequency: number = PT_DEFAULT_FREQ;

    vibratoAmount: number = 0.005;
    vibratoFrequency: number = 6;

    UITenseness: number = PT_DEFAULT_TENSENESS;
    tenseness: number = PT_DEFAULT_TENSENESS;
    oldTenseness: number = PT_DEFAULT_TENSENESS;
    newTenseness: number = PT_DEFAULT_TENSENESS;

    intensity: number = 1;
    loudness: number = 1;

    noise = new Noise();

    readonly isTouched = false;
    readonly alwaysVoice = true;

    timeInWaveform: number = 0;
    totalTime: number = 0;
    waveformLength: number = 1 / PT_DEFAULT_FREQ;
    alpha!: number;
    E0!: number;
    epsilon!: number;
    shift!: number;
    Delta!: number;
    Te!: number;
    omega!: number;

    constructor() {
        super();
        this.setupWaveform(0);
    }

    setupWaveform(lambda: number) {
        this.frequency = this.oldFrequency * (1-lambda) + this.newFrequency * lambda;
        this.waveformLength = 1 / this.frequency;
        const tenseness = this.oldTenseness * (1-lambda) + this.newTenseness * lambda;
        let Rd = 3 * (1 - tenseness); //TODO: const with constrain
        
        if (Rd < 0.5) Rd = 0.5;
        if (Rd > 2.7) Rd = 2.7;

        const Ra = -0.01 + 0.048 * Rd;
        const Rk = 0.224 + 0.118 * Rd;
        const Rg = (Rk / 4) * (0.5 + 1.2 * Rk) / (0.11 * Rd - Ra * (0.5 + 1.2 * Rk));
        
        const Ta = Ra;
        const Tp = 1 / (2 * Rg);
        const Te = Tp + Tp * Rk; 
        
        const epsilon = 1 / Ta;
        const shift = Math.exp(-epsilon * (1-Te));
        const Delta = 1 - shift; 
        
        const RHSIntegral = ((1 / epsilon) * (shift - 1) + (1-Te) * shift)/Delta;        
        const totalLowerIntegral = -(Te-Tp)/2 + RHSIntegral;
        const totalUpperIntegral = -totalLowerIntegral;
        
        const omega = Math.PI / Tp;
        const s = Math.sin(omega * Te);
        const y = -Math.PI * s * totalUpperIntegral / (Tp*2);
        const z = Math.log(y);
        const alpha = z / (Tp/2 - Te);
        const E0 = -1 / (s * Math.exp(alpha * Te));
        this.alpha = alpha;
        this.E0 = E0;
        this.epsilon = epsilon;
        this.shift = shift;
        this.Delta = Delta;
        this.Te = Te;
        this.omega = omega;
    }

    normalizedLFWaveform(t: number) {  
        let output;   
        if (t>this.Te) output = (-Math.exp(-this.epsilon * (t-this.Te)) + this.shift)/this.Delta;
        else output = this.E0 * Math.exp(this.alpha*t) * Math.sin(this.omega * t);
        return output * this.intensity * this.loudness;
    }

    runStep(lambda: number, noiseSource: number) {
        const timeStep = 1.0 / sampleRate; 
        this.timeInWaveform += timeStep;
        this.totalTime += timeStep;
        if (this.timeInWaveform>this.waveformLength) {
            this.timeInWaveform -= this.waveformLength;
            this.setupWaveform(lambda);
        }
        let out = this.normalizedLFWaveform(this.timeInWaveform/this.waveformLength);
        const noiseModulator = this.getNoiseModulator();
        let aspiration = this.intensity*(1-Math.sqrt(this.UITenseness))*noiseModulator*noiseSource;
        aspiration *= 0.2 + 0.02*this.noise.simplex1(this.totalTime * 1.99);
        out += aspiration;
        return [out, noiseModulator] as const;
    }

    finishBlock() {
        let vibrato = 0;
        vibrato += this.vibratoAmount * Math.sin(2*Math.PI * this.totalTime * this.vibratoFrequency);          
        vibrato += 0.02 * this.noise.simplex1(this.totalTime * 4.07);
        // vibrato += 0.04 * this.noise.simplex1(this.totalTime * 2.15);
        if (this.UIFrequency>this.smoothFrequency) 
            this.smoothFrequency = Math.min(this.smoothFrequency * 1.1, this.UIFrequency);
        if (this.UIFrequency<this.smoothFrequency) 
            this.smoothFrequency = Math.max(this.smoothFrequency / 1.1, this.UIFrequency);
        this.oldFrequency = this.newFrequency;
        this.newFrequency = this.smoothFrequency * (1+vibrato);
        this.oldTenseness = this.newTenseness;
        this.newTenseness = this.UITenseness
            + 0.1*this.noise.simplex1(this.totalTime*0.46)+0.05*this.noise.simplex1(this.totalTime*0.36);

        // if (!this.isTouched && this.alwaysVoice) this.newTenseness += (3-this.UITenseness)*(1-this.intensity);
        // if (this.isTouched || this.alwaysVoice) this.intensity += 0.13;
        // else this.intensity -= 0.05;

        this.intensity = constrain(this.intensity, 0, 1);
    }

    getNoiseModulator() {
        const voiced = 0.1+0.2*Math.max(0,Math.sin(Math.PI*2*this.timeInWaveform/this.waveformLength));
        return this.UITenseness * this.intensity * voiced + (1 - this.UITenseness * this.intensity ) * 0.3;
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const noiseIn = inputs[0][0];
        const glottisOut = outputs[0][0];
        const noiseModOut = outputs[1][0];
        const intensityOut = outputs[2][0];

        if (!noiseIn || !glottisOut || !noiseModOut || !intensityOut) return true;

        const outLen = glottisOut.length;
        for (let i = 0; i < outLen; i++) {
            const frequency = parameters["frequency"][i] ?? parameters["frequency"][0];
            const pitchbend = parameters["pitchbend"][i] ?? parameters["pitchbend"][0]; 
            
            this.UIFrequency = frequency * Math.pow(2, pitchbend / 12);
            this.intensity = parameters["intensity"][i] ?? parameters["intensity"][0];
            this.UITenseness = (parameters["tenseness"][i] ?? parameters["tenseness"][0])
                * (parameters["tenseness-scale"][i] ?? parameters["tenseness-scale"][0]);
            this.loudness = Math.pow(this.UITenseness, 0.25); 
            [glottisOut[i], noiseModOut[i]] = this.runStep(i / outLen, noiseIn[i]); 
            intensityOut[i] = this.intensity;
        }
        this.finishBlock();
        return true;
    }
}

type Transient = {position: number, strength: number, exponent: number, timeAlive: number, lifeTime: number};

class TractProcessor extends AudioWorkletProcessor {

    static get parameterDescriptors() : AudioParamDescriptor[] {
        return [
            {
                name: "n",
                defaultValue: 44,
                minValue: 30,
                automationRate: "k-rate"
            },
            {
                name: "tongue-index",
                defaultValue: 0.05,
                minValue: 0,
                maxValue: 1,
                automationRate: "a-rate"
            },
            {
                name: "tongue-diameter",
                defaultValue: 2.43,
                minValue: 2.05,
                maxValue: 3.5,
                automationRate: "a-rate"
            },
            {
                name: "constriction-width",
                defaultValue: 1,
                minValue: 0,
                automationRate: "k-rate"
            },
            {
                name: "constriction-index",
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                automationRate: "a-rate"
            },
            {
                name: "constriction-diameter",
                defaultValue: 3,
                minValue: 0,
                maxValue: 5,
                automationRate: "a-rate"
            },
            {
                name: "velum-target",
                defaultValue: 0.01,
                minValue: 0.01,
                maxValue: 0.4,
                automationRate: "a-rate"
            },
            {
                name: "movement-speed",
                defaultValue: 15,
                minValue: 0,
                automationRate: "k-rate"
            }
        ]
    }

    n = 44;
    velumTarget = 0.01;
    diameter!: Float64Array;
    restDiameter!: Float64Array;
    targetDiameter!: Float64Array;

    hasTongue = true;
    tongueIndex = 12.9;
    tongueDiameter = 2.43;
    constrictionWidth = 1;
    constrictionIndex = 0;
    constrictionDiameter = 3;
    movementSpeed = 15;

    blockTime = 128 / sampleRate; 
    // newDiameter!: Float64Array;
    R!: Float64Array;
    L!: Float64Array;
    reflection!: Float64Array;
    newReflection!: Float64Array;
    junctionOutputR!: Float64Array;
    junctionOutputL!: Float64Array;
    A!: Float64Array;
    // maxAmplitude!: Float64Array;
    bladeStart!: number;
    tipStart!: number;
    lipStart!: number;
    tongueLowerIndexBound!: number;
    tongueUpperIndexBound!: number;
    noseLength!: number;
    noseStart!: number;
    noseR!: Float64Array;
    noseL!: Float64Array;
    noseJunctionOutputR!: Float64Array;
    noseJunctionOutputL!: Float64Array;
    noseReflection!: Float64Array;
    noseDiameter!: Float64Array;
    noseA!: Float64Array;
    // noseMaxAmplitude!: Float64Array;
    reflectionLeft!: number;
    reflectionRight!: number;
    reflectionNose!: number;
    newReflectionLeft!: number;
    newReflectionRight!: number;
    newReflectionNose!: number;
    glottalReflection = 0.75;
    lipReflection = -0.85;
    lipOutput = 0;
    noseOutput = 0;
    lastObstruction = -1;
    transients: Transient[] = [];
    intensity = 1;

    constructor(options?: Partial<AudioWorkletNodeOptions>) {
        super();
        this.init();
        this.port.start();
        this.port.postMessage({diameters: this.diameter, velum: this.noseDiameter[0]});
        this.port.onmessage = ({data}) => { 
            let diameters = data.diameters as ArrayLike<number> | undefined;
            if (!diameters) return;
            diameters = diameters.length !== this.n ? linear(
                new Array(this.n).fill(0).map((_, i) => i/(this.n - 1)),
                new Array(data.diameters.length).fill(0).map((_, i) => i/(diameters!.length - 1)),
                Array.from(diameters)
            ) : diameters;
            this.restDiameter.set(diameters); 
        }
        this.hasTongue = options?.processorOptions?.hasTongue ?? true;
    }

    init(n = this.n) {
        this.n = n;
        this.bladeStart = Math.floor(10*this.n/44);
        this.tipStart = Math.floor(32*this.n/44);
        this.lipStart = Math.floor(39*this.n/44);    
        this.tongueLowerIndexBound = this.bladeStart + 2; 
        this.tongueUpperIndexBound = this.tipStart - 3;   

        this.diameter = new Float64Array(this.n);
        this.restDiameter = new Float64Array(this.n);
        this.targetDiameter = new Float64Array(this.n);
        // this.newDiameter = new Float64Array(this.n);
        this.getRestDiameters();

        this.R = new Float64Array(this.n);
        this.L = new Float64Array(this.n);
        this.reflection = new Float64Array(this.n+1);
        this.newReflection = new Float64Array(this.n+1);
        this.junctionOutputR = new Float64Array(this.n+1);
        this.junctionOutputL = new Float64Array(this.n+1);
        this.A =new Float64Array(this.n);
        // this.maxAmplitude = new Float64Array(this.n);
        
        this.noseLength = Math.floor(28*this.n/44)
        this.noseStart = this.n-this.noseLength + 1;
        this.noseR = new Float64Array(this.noseLength);
        this.noseL = new Float64Array(this.noseLength);
        this.noseJunctionOutputR = new Float64Array(this.noseLength+1);
        this.noseJunctionOutputL = new Float64Array(this.noseLength+1);        
        this.noseReflection = new Float64Array(this.noseLength+1);
        this.noseDiameter = new Float64Array(this.noseLength);
        this.noseA = new Float64Array(this.noseLength);
        // this.noseMaxAmplitude = new Float64Array(this.noseLength);
        for (let i = 0; i < this.noseLength; i++) {
            let d = 2 * (i/this.noseLength);
            let diameter;
            if (d < 1) diameter = 0.4+1.6*d;
            else diameter = 0.5+1.5*(2-d);
            diameter = Math.min(diameter, 1.9);
            this.noseDiameter[i] = diameter;
        }       
        this.newReflectionLeft = this.newReflectionRight = this.newReflectionNose = 0;
        this.calculateReflections();        
        this.calculateNoseReflections();
        this.noseDiameter[0] = this.velumTarget;

        this.setTargetDiameters();
    }

    getRestDiameters() {
        for (let i=0; i<this.n; i++) {
            let diameter = 0;
            if (i<7*this.n/44-0.5) diameter = 0.6;
            else if (i<12*this.n/44) diameter = 1.1;
            else diameter = 1.5;
            this.diameter[i] = this.restDiameter[i] = this.targetDiameter[i] = /* this.newDiameter[i] = */ diameter;
        }
    }

    calculateReflections(){
        for (let i = 0; i < this.n; i++) {
            this.A[i] = this.diameter[i] * this.diameter[i]; 
        }
        for (let i = 1; i < this.n; i++) {
            this.reflection[i] = this.newReflection[i];
            if (this.A[i] == 0) this.newReflection[i] = 0.999; 
            else this.newReflection[i] = (this.A[i-1] - this.A[i]) / (this.A[i-1] + this.A[i]); 
        }
        
        this.reflectionLeft = this.newReflectionLeft;
        this.reflectionRight = this.newReflectionRight;
        this.reflectionNose = this.newReflectionNose;
        let sum = this.A[this.noseStart] + this.A[this.noseStart+1] + this.noseA[0];
        this.newReflectionLeft = (2 * this.A[this.noseStart] - sum) / sum;
        this.newReflectionRight = (2 * this.A[this.noseStart+1] - sum) / sum;   
        this.newReflectionNose = (2 * this.noseA[0] - sum) / sum;      
    }

    calculateNoseReflections(){
        for (let i = 0; i < this.noseLength; i++) {
            this.noseA[i] = this.noseDiameter[i] * this.noseDiameter[i]; 
        }
        for (let i=1; i < this.noseLength; i++) {
            this.noseReflection[i] = (this.noseA[i-1] - this.noseA[i]) / (this.noseA[i-1] + this.noseA[i]); 
        }
    }

    addTransient(position: number) {
        const strength = 0.3 * this.intensity * (1 - this.noseDiameter[0]/0.4) ** 2;
        const transient: Transient = {
            position, timeAlive: 0, lifeTime: 0.2, strength, exponent: 200
        }
        this.transients.push(transient);
    }

    processTransients(){
        for (let i = 0; i < this.transients.length; i++) {
            const trans = this.transients[i];
            const amplitude = trans.strength * Math.pow(2, -trans.exponent * trans.timeAlive);
            this.R[trans.position] += amplitude/2;
            this.L[trans.position] += amplitude/2;
            trans.timeAlive += 1.0/(sampleRate*2);
        }
        for (let i = this.transients.length - 1; i >= 0; i--) {
            const trans = this.transients[i];
            if (trans.timeAlive > trans.lifeTime) this.transients.splice(i,1);
        }
    }
    
    addTurbulenceNoise(turbulenceNoise: number, noiseModulator: number) {
        const index = this.constrictionIndex;
        const diameter = (this.hasTongue ? this.constrictionDiameter : this.diameter[Math.round(index)]) + 0.3; 
        if (index <= 0 || index >= this.n - 1) return;
        this.addTurbulenceNoiseAtIndex(0.66 * turbulenceNoise * this.intensity, index, diameter, noiseModulator);
    }
    
    addTurbulenceNoiseAtIndex(turbulenceNoise: number, index: number, diameter: number, noiseModulator: number) {  
        const i = Math.floor(index);
        const delta = index - i;
        turbulenceNoise *= noiseModulator;
        const thinness0 = constrain(8 * (0.7-diameter), 0, 1);
        const openness = constrain(30 * (diameter-0.3), 0, 1);
        const noise0 = turbulenceNoise*(1-delta)*thinness0*openness;
        const noise1 = turbulenceNoise*delta*thinness0*openness;
        this.R[i+1] += noise0/2;
        this.L[i+1] += noise0/2;
        this.R[i+2] += noise1/2;
        this.L[i+2] += noise1/2;
    }

    setTargetDiameters() {
        this.targetDiameter.set(this.restDiameter);
        if (this.hasTongue) {

            for (let i = this.bladeStart; i < this.lipStart; i++) {
                let t = 1.1 * Math.PI * (this.tongueIndex - i) / (this.tipStart - this.bladeStart);
                let fixedTongueDiameter = 2 + (this.tongueDiameter - 2) / 1.5;
                let curve = (1.5 - fixedTongueDiameter + 1.7) * Math.cos(t);
                if (i == this.bladeStart - 2 || i == this.lipStart - 1) curve *= 0.8;
                if (i == this.bladeStart || i == this.lipStart - 2) curve *= 0.94;               
                this.targetDiameter[i] = 1.5 - curve;
            }
        }

        const index = this.constrictionIndex;
        const diameter = Math.max(0, this.constrictionDiameter);        
        let width=2;
        if (index < 25) width = 10;
        else if (index >= this.tipStart) width= 5;
        else width = 10 - 5 * (index - 25) / (this.tipStart - 25);
        width *= this.constrictionWidth;
        if (index >= 2 && index < this.n && width > 0) {
            const intIndex = Math.round(index);
            for (let i = -Math.ceil(width) - 1; i < width + 1; i++) {   
                if (intIndex + i < 0 || intIndex + i >= this.n) continue;
                let relpos = (intIndex + i) - index;
                relpos = Math.abs(relpos) - 0.5;
                let shrink;
                if (relpos <= 0) shrink = 0;
                else if (relpos > width) shrink = 1;
                else shrink = 0.5*(1-Math.cos(Math.PI * relpos / width));
                if (diameter < this.targetDiameter[intIndex+i])
                {
                    this.targetDiameter[intIndex+i] = diameter + (this.targetDiameter[intIndex+i]-diameter)*shrink;
                }
            }
        }
    }

    reshapeTract() {
        const deltaTime = this.blockTime;
        let amount = deltaTime * this.movementSpeed;  
        let newLastObstruction = -1;
        for (let i = 0; i < this.n; i++) {
            const diameter = this.diameter[i];
            const targetDiameter = this.targetDiameter[i];
            if (diameter <= 0) newLastObstruction = i;
            let slowReturn; 
            if (i<this.noseStart) slowReturn = 0.6;
            else if (i >= this.tipStart) slowReturn = 1.0; 
            else slowReturn = 0.6+0.4*(i-this.noseStart)/(this.tipStart-this.noseStart);
            this.diameter[i] = moveTowards(diameter, targetDiameter, 
                (this.hasTongue ? slowReturn : 1) * amount, 
                (this.hasTongue ? 2 : 1) * amount
            );
        }
        if (this.lastObstruction>-1 && newLastObstruction == -1 && this.noseA[0]<0.05) {
            this.addTransient(this.lastObstruction);
        }
        this.lastObstruction = newLastObstruction;
        
        amount = deltaTime * this.movementSpeed; 
        this.noseDiameter[0] = moveTowards(this.noseDiameter[0], this.velumTarget, 
            amount*0.25, amount*0.1);
        this.noseA[0] = this.noseDiameter[0]*this.noseDiameter[0];        
    }

    runStep(glottalOutput: number, turbulenceNoise: number, lambda: number, noiseModulator: number) {    
        //mouth
        this.processTransients();
        this.addTurbulenceNoise(turbulenceNoise, noiseModulator);
        
        //this.glottalReflection = -0.8 + 1.6 * Glottis.newTenseness;
        this.junctionOutputR[0] = this.L[0] * this.glottalReflection + glottalOutput;
        this.junctionOutputL[this.n] = this.R[this.n-1] * this.lipReflection; 
        
        for (let i=1; i<this.n; i++) {
            const r = this.reflection[i] * (1-lambda) + this.newReflection[i]*lambda;
            const w = r * (this.R[i-1] + this.L[i]);
            this.junctionOutputR[i] = this.R[i-1] - w;
            this.junctionOutputL[i] = this.L[i] + w;
        }    
        
        //now at junction with nose
        const i = this.noseStart;
        let r = this.newReflectionLeft * (1-lambda) + this.reflectionLeft*lambda;
        this.junctionOutputL[i] = r*this.R[i-1]+(1+r)*(this.noseL[0]+this.L[i]);
        r = this.newReflectionRight * (1-lambda) + this.reflectionRight*lambda;
        this.junctionOutputR[i] = r*this.L[i]+(1+r)*(this.R[i-1]+this.noseL[0]);     
        r = this.newReflectionNose * (1-lambda) + this.reflectionNose*lambda;
        this.noseJunctionOutputR[0] = r*this.noseL[0]+(1+r)*(this.L[i]+this.R[i-1]);
         
        for (let i = 0; i < this.n; i++) {          
            this.R[i] = this.junctionOutputR[i]*0.999;
            this.L[i] = this.junctionOutputL[i+1]*0.999;   
            // if (updateAmplitudes) {   
            //     const amplitude = Math.abs(this.R[i]+this.L[i]);
            //     if (amplitude > this.maxAmplitude[i]) this.maxAmplitude[i] = amplitude;
            //     else this.maxAmplitude[i] *= 0.999;
            // }
        }

        this.lipOutput = this.R[this.n-1];
        
        //nose     
        this.noseJunctionOutputL[this.noseLength] = this.noseR[this.noseLength-1] * this.lipReflection; 
        
        for (let i = 1; i < this.noseLength; i++) {
            const w = this.noseReflection[i] * (this.noseR[i-1] + this.noseL[i]);
            this.noseJunctionOutputR[i] = this.noseR[i-1] - w;
            this.noseJunctionOutputL[i] = this.noseL[i] + w;
        }
        
        for (let i = 0; i < this.noseLength; i++) {
            this.noseR[i] = this.noseJunctionOutputR[i];
            this.noseL[i] = this.noseJunctionOutputL[i+1];   
            
            //commented out in original:
            // this.noseR[i] = Math.clamp(this.noseJunctionOutputR[i] * this.fade, -1, 1);
            // this.noseL[i] = Math.clamp(this.noseJunctionOutputL[i+1] * this.fade, -1, 1);    
            
            // if (updateAmplitudes)
            // {
            //     const amplitude = Math.abs(this.noseR[i]+this.noseL[i]);
            //     if (amplitude > this.noseMaxAmplitude[i]) this.noseMaxAmplitude[i] = amplitude;
            //     else this.noseMaxAmplitude[i] *= 0.999;
            // }
        }

        this.noseOutput = this.noseR[this.noseLength-1];
    }

    finishBlock() {  
        this.setTargetDiameters();       
        this.reshapeTract();
        this.calculateReflections();
    }

    process(inputs: (Float32Array | undefined)[][], outputs: (Float32Array | undefined)[][], 
        parameters: Record<string, Float32Array>) : boolean 
    {

        const glottisIn = inputs[0][0];
        const noiseIn = inputs[1][0];
        const noiseModulatorIn = inputs[2][0];
        const intensityIn = inputs[3][0];
        const voiceOut = outputs[0][0];

        if (!glottisIn || !noiseIn || !noiseModulatorIn || !intensityIn || !voiceOut) return true;

        const newN = Math.floor(parameters["n"][0]);
        if (newN != this.n) this.init(newN);

        this.constrictionWidth = parameters["constriction-width"][0];

        for (let i = 0; i < voiceOut.length; i++) {
            this.movementSpeed = parameters["movement-speed"][0] ?? parameters["movement-speed"][i];
            this.tongueIndex = (parameters["tongue-index"][i] ?? parameters["tongue-index"][0]) 
                * (this.tongueUpperIndexBound - this.tongueLowerIndexBound) + this.tongueLowerIndexBound;
            this.tongueDiameter = parameters["tongue-diameter"][i] ?? parameters["tongue-diameter"][0];
            this.constrictionIndex = (parameters["constriction-index"][i] ?? parameters["constriction-index"][0]) 
                * (this.n - 1);
            this.constrictionDiameter = parameters["constriction-diameter"][i] ?? parameters["constriction-diameter"][0];
            this.velumTarget = parameters["velum-target"][i] ?? parameters["velum-target"][0];
            this.intensity = intensityIn[i];

            const lambda1 = i / voiceOut.length;
            const lambda2 = (i + .5) / voiceOut.length;
            let output = 0;
            this.runStep(glottisIn[i], noiseIn[i], lambda1, noiseModulatorIn[i]);
            output += this.lipOutput + this.noseOutput;
            this.runStep(glottisIn[i], noiseIn[i], lambda2, noiseModulatorIn[i]);
            output += this.lipOutput + this.noseOutput;
            voiceOut[i] = output * 0.125;
        }

        this.finishBlock();
        const shapeUpdate = {diameters: this.diameter, velum: this.noseDiameter[0]};
        this.port.postMessage(shapeUpdate);
        return true;
    }
}

export function constrain(n: number, low: number, high: number): number {
    return Math.max(Math.min(n, high), low);
};

function moveTowards(current: number, target: number, amountUp: number, amountDown: number) {
    if (current<target) return Math.min(current+amountUp, target);
    else return Math.max(current-amountDown, target);
}

registerProcessor("glottis-processor", GlottisProcessor);
registerProcessor("tract-processor", TractProcessor);