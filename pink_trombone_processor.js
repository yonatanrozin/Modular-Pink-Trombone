/*
    Modular Pink Trombone
    By Yonatan Rozin

    A modular version of Pink Trombone that allows for faster audio processing
    and multiple simultaneous voices.

    Modifications from original:
    -   Deprecated ScriptProcessorNode has been replaced with new AudioWorkletNode
            - This allows the audio processing to run in a separate thread from
            the main script, making it MUCH faster and non-blocking
    -   Pink Trombone objects (Tract, Glottis) integrated as AudioWorkletProcessor
        class objects, allowing for multiple simultaneous Pink Trombone voices
            - The original noise module has been made into a class, allowing for
            each voice to have its own noise modules, with a unique noise seed.
            This allows noisy signals (ex. vibrato) to be different per voice
            This de-syncing can be reversed by setting the noise seeds to the same
            number (this.noise.seed(0)) in VocalWorkletProcessor constructor
    -   UI has been removed, it may possibly be re-integrated later.
    -   Tract.addTurbulenceNoise() has been modified (since UI has been removed)
        to allow fricatives to still be produced:
            - Instead of relying on UI touches, addTurbulence noise simulates "touch"
            using the value and location of the smallest current diameter, aka the
            point of highest constriction in the vocal tract. These values are updated
            constantly in Tract.reshapeTract(). A new fIntensity
            variable has been added to the Tract object that determines the volume
            of fricative noise. This allows letters that differ only by fricative
            volume (for example, T and N) to remain distinguishable from one another

    Built using Pink Trombone
    version 1.1, March 2017
    by Neil Thapen
    venuspatrol.nfshost.com

    Copyright 2017 Neil Thapen

    Permission is hereby granted, free of charge, to any person obtaining a
    copy of this software and associated documentation files (the "Software"),
    to deal in the Software without restriction, including without limitation
    the rights to use, copy, modify, merge, publish, distribute, sublicense,
    and / or sell copies of the Software, and to permit persons to whom the
    Software is furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
    IN THE SOFTWARE.
*/

import Noise from "./noise.js";

function clamp(number, min, max) {
  if (number < min) return min;
  else if (number > max) return max;
  else return number;
}

function moveTowards(current, target, amountUp, amountDown) {
  if (current < target) return Math.min(current + amountUp, target);
  else return Math.max(current - amountDown, target);
}

/*
 *  Voice processor
 *      parameters: former properties of Tract and Glottis objects have been made into
 *      audioParams of the audioWorklet for easy access.
 *          Use <audioworklet>.parameters.get("parameterName").value to change OR
 *          Use any Web Audio API audioParam methods (for ramps, etc.)
 *              Ex: <audioWorklet>.parameters.get('frequency').setValueAtTime(...);
 *      Noise: each processor has its own instance of the noise.js module, allowing
 *      each voice to have its own internal noise for time-based parameters such as voice wobble
 *          Noise.seed() is used to synchronize or de-synchronize the internal noise values
 *              Random value (Noise.seed(Math.random())) for de-synced or any constant for synced
 */
class VocalWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "frequency",
        defaultValue: 140,
        minValue: 0,
        maxValue: 2000,
        automationRate: "a-rate"
      },
      {
        name: "tenseness",
        defaultValue: 0.6,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate"
      },
      /*  
       *    New to modular_pink_trombone: base-tenseness
       *    A multiplier of all tenseness values (0 - 1)
       *    Set to 1 for pink trombone default behavior
       */
      {
        name: "base-tenseness",
        defaultValue: 0.6,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate"
      },

      {
        name: "intensity",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate"
      },
      /*
       *    New to modular_pink_trombone: fricative intensity
       *    Sets volume of fricatives (white noise due to tract constriction)
       *    0 (off) -> 1 (default) -> 2 (extra loud, if desired)
       */
      {
        name: "fricative-intensity",
        defaultValue: 0,
        minValue: 0,
        maxValue: 2,
        automationRate: "a-rate"
      },
      /*
       *    New to modular_pink_trombone: transient intensity
       *    Sets volume of transients (clicks when tongue ends contact with roof of mouth)
       *    0 (off) -> 1 (loud), Pink Trombone default = 0.3
       */
      {
        name: "transient-intensity",
        defaultValue: 0.3,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate"
      },
      {
        name: "loudness",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate"
      },
      {
        name: "vibrato-amount",
        defaultValue: 0.005,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate"
      },
      {
        name: "vibrato-frequency",
        defaultValue: 6,
        minValue: 0,
        maxValue: 100,
        automationRate: "a-rate"
      },
      {
        name: "velum-target",
        defaultValue: 0.01,
        minValue: 0,
        maxValue: 1,
        automationRate: "a-rate"
      },

      /*
       *    New to modular_pink_trombone: constriction index + diameter:
       *    Replace mouse click index + diameter (in absence of UI)
       *    To replicate original pink trombone - 
       *        Set diameter to smallest value of tract diameters relevant to consonant
       *            Ignore vowel diameters (throat, lips, etc)
       *        Set index to location of smallest diameter within Tract.diameter
       */
      {
        name: "constriction-index",
        defaultValue: null,
        minValue: 0,
        maxValue: 44,
        automationRate: "a-rate"
      },
      {
        name: "constriction-diameter",
        defaultValue: null,
        minValue: 0,
        maxValue: 5,
        automationRate: "a-rate"
      },
      /*
       *    Optional - panning: -1 (left) -> 1 (right)
       *    Set to 0 for no panning
       */
      {
        name: "pan",
        defaultValue: 0,
        minValue: -1,
        maxValue: 1,
        automationRate: "a-rate"
      }
    ];
  }

  constructor(options) {
    super();

    this.blockTime = 128 / sampleRate; //from pinktrombone AudioSystem.init()
    this.voiceNum = options.processorOptions.voiceNum;

    var self = this; //to refer to this WorkletProcessor from inside nested objects/callbacks

    this.noise = new Noise(); //import noise module instance

    //set random noise seed to de-synchronize time-based parameters (voice wobble, etc.)
    //set to any constant to synchronize wobble (reduces realism)
    this.noise.seed(Math.random()); //this.noise.seed(0) to synchronize

    this.autoWobble = false;
    this.alwaysVoice = true;

    //receive messages from main script
    this.port.onmessage = function(e) {
      self.processMessage(e.data);
    };

    this.Glottis = {
      timeInWaveform: 0,
      oldFrequency: 140,
      newFrequency: 140,
      smoothFrequency: 140,
      oldTenseness: 0,
      newTenseness: 0,
      totalTime: 0,
      vibratoAmount: 0.01,
      vibratoFrequency: 6,
      intensity: 0,
      loudness: 0,
      isTouched: false,
      aIntensity: 0,

      init: function() {
        this.setupWaveform(0);
      },

      runStep: function(lambda, noiseSource) {
        var timeStep = 1.0 / sampleRate;
        this.timeInWaveform += timeStep;
        this.totalTime += timeStep;
        if (this.timeInWaveform > this.waveformLength) {
          this.timeInWaveform -= this.waveformLength;
          this.setupWaveform(lambda);
        }

        var out = this.normalizedLFWaveform(
          this.timeInWaveform / this.waveformLength
        );

        var aspiration =
          this.intensity *
          (1 - Math.sqrt(this.UITenseness)) *
          this.getNoiseModulator() *
          noiseSource;
        aspiration *= 0.6 + 0.02 * self.noise.simplex1(this.totalTime * 1.99);
        out += aspiration;
        return out;
      },

      getNoiseModulator: function() {
        var voiced =
          0.1 +
          0.2 *
            Math.max(
              0,
              Math.sin(Math.PI * 2 * this.timeInWaveform / this.waveformLength)
            );
        return (
          this.UITenseness * this.intensity * voiced +
          (1 - this.UITenseness * this.intensity) * 0.3 //*0.3 originally
        );
      },

      finishBlock: function() {
        var vibrato = 0;
        vibrato +=
          this.vibratoAmount *
          Math.sin(2 * Math.PI * this.totalTime * this.vibratoFrequency);
        vibrato += 0.02 * self.noise.simplex1(this.totalTime * 4.07);
        vibrato += 0.04 * self.noise.simplex1(this.totalTime * 2.15);
        if (self.autoWobble) {
          vibrato += 0.2 * self.noise.simplex1(this.totalTime * 0.98);
          vibrato += 0.4 * self.noise.simplex1(this.totalTime * 0.5);
        }
        if (this.UIFrequency > this.smoothFrequency)
          this.smoothFrequency = Math.min(
            this.smoothFrequency * 1.1,
            this.UIFrequency
          );
        if (this.UIFrequency < this.smoothFrequency)
          this.smoothFrequency = Math.max(
            this.smoothFrequency / 1.1,
            this.UIFrequency
          );
        this.oldFrequency = this.newFrequency;
        this.newFrequency = this.smoothFrequency * (1 + vibrato);
        this.oldTenseness = this.newTenseness;
        this.newTenseness =
          this.UITenseness +
          0.1 * self.noise.simplex1(this.totalTime * 0.46) +
          0.05 * self.noise.simplex1(this.totalTime * 0.36);
        /*       if (!this.isTouched && self.alwaysVoice)
              this.newTenseness += (3 - this.UITenseness) * (1 - this.intensity);

            if (this.isTouched || self.alwaysVoice) this.intensity += 0.13;
            else this.intensity -= 0.05;*/
        this.intensity = clamp(this.intensity, 0, 1);
      },

      setupWaveform: function(lambda) {
        this.frequency =
          this.oldFrequency * (1 - lambda) + this.newFrequency * lambda;
        var tenseness =
          this.oldTenseness * (1 - lambda) + this.newTenseness * lambda;
        this.Rd = 3 * (1 - tenseness);
        this.waveformLength = 1.0 / this.frequency;

        var Rd = this.Rd;
        if (Rd < 0.5) Rd = 0.5;
        if (Rd > 2.7) Rd = 2.7;
        var output;
        var Ra = -0.01 + 0.048 * Rd;
        var Rk = 0.224 + 0.118 * Rd;
        var Rg =
          Rk / 4 * (0.5 + 1.2 * Rk) / (0.11 * Rd - Ra * (0.5 + 1.2 * Rk));

        var Ta = Ra;
        var Tp = 1 / (2 * Rg);
        var Te = Tp + Tp * Rk;

        var epsilon = 1 / Ta;
        var shift = Math.exp(-epsilon * (1 - Te));
        var Delta = 1 - shift;

        var RHSIntegral = 1 / epsilon * (shift - 1) + (1 - Te) * shift;
        RHSIntegral = RHSIntegral / Delta;

        var totalLowerIntegral = -(Te - Tp) / 2 + RHSIntegral;
        var totalUpperIntegral = -totalLowerIntegral;

        var omega = Math.PI / Tp;
        var s = Math.sin(omega * Te);

        var y = -Math.PI * s * totalUpperIntegral / (Tp * 2);
        var z = Math.log(y);
        var alpha = z / (Tp / 2 - Te);
        var E0 = -1 / (s * Math.exp(alpha * Te));
        this.alpha = alpha;
        this.E0 = E0;
        this.epsilon = epsilon;
        this.shift = shift;
        this.Delta = Delta;
        this.Te = Te;
        this.omega = omega;
      },

      normalizedLFWaveform: function(t) {
        var output;
        if (t > this.Te)
          output =
            (-Math.exp(-this.epsilon * (t - this.Te)) + this.shift) /
            this.Delta;
        else
          output =
            this.E0 * Math.exp(this.alpha * t) * Math.sin(this.omega * t);

        return output * this.intensity * this.loudness;
      }
    };

    this.Tract = {
      n: 44,
      bladeStart: 10,
      tipStart: 32,
      lipStart: 39,
      R: [], //component going right
      L: [], //component going left
      reflection: [],
      junctionOutputR: [],
      junctionOutputL: [],
      maxAmplitude: [],
      diameter: [],
      restDiameter: [],
      targetDiameter: [],
      newDiameter: [],
      A: [],
      glottalReflection: 0.75,
      lipReflection: -0.85,
      lastObstruction: -1,
      fade: 1.0, //0.9999,
      movementSpeed: 15, //cm per second
      transients: [],
      lipOutput: 0,
      noseOutput: 0,
      velumTarget: 0.01,
      fIntensity: 0, //intensity of fricatives
      tIntensity: 0.3, //intensity of transients(clicks)
      constrictionIndex: 0,
      constrictionDiameter: 5,

      init: function() {
        this.bladeStart = Math.floor(this.bladeStart * 44 / 44);
        this.tipStart = Math.floor(this.tipStart * 44 / 44);
        this.lipStart = Math.floor(this.lipStart * 44 / 44);
        this.diameter = new Float64Array(44);
        this.restDiameter = new Float64Array(44);
        this.targetDiameter = new Float64Array(44);
        this.newDiameter = new Float64Array(44);
        for (var i = 0; i < 44; i++) {
          var diameter = 0;
          if (i < 7 * 44 / 44 - 0.5) diameter = 0.6;
          else if (i < 12 * 44 / 44) diameter = 1.1;
          else diameter = 1.5;
          this.diameter[i] = this.restDiameter[i] = this.targetDiameter[
            i
          ] = this.newDiameter[i] = diameter;
        }
        this.R = new Float64Array(44);
        this.L = new Float64Array(44);
        this.reflection = new Float64Array(44 + 1);
        this.newReflection = new Float64Array(44 + 1);
        this.junctionOutputR = new Float64Array(44 + 1);
        this.junctionOutputL = new Float64Array(44 + 1);
        this.A = new Float64Array(44);
        this.maxAmplitude = new Float64Array(44);

        this.noseLength = Math.floor(28 * 44 / 44);
        this.noseStart = 44 - this.noseLength + 1;
        this.noseR = new Float64Array(this.noseLength);
        this.noseL = new Float64Array(this.noseLength);
        this.noseJunctionOutputR = new Float64Array(this.noseLength + 1);
        this.noseJunctionOutputL = new Float64Array(this.noseLength + 1);
        this.noseReflection = new Float64Array(this.noseLength + 1);
        this.noseDiameter = new Float64Array(this.noseLength);
        this.noseA = new Float64Array(this.noseLength);
        this.noseMaxAmplitude = new Float64Array(this.noseLength);
        for (var i = 0; i < this.noseLength; i++) {
          var diameter;
          var d = 2 * (i / this.noseLength);
          if (d < 1) diameter = 0.4 + 1.6 * d;
          else diameter = 0.5 + 1.5 * (2 - d);
          diameter = Math.min(diameter, 1.9);
          this.noseDiameter[i] = diameter;
        }
        this.newReflectionLeft = this.newReflectionRight = this.newReflectionNose = 0;
        this.calculateReflections();
        this.calculateNoseReflections();
        this.noseDiameter[0] = this.velumTarget;
      },

      reshapeTract: function(deltaTime) {
        var amount = deltaTime * this.movementSpeed;
        var newLastObstruction = -1;
        for (var i = 0; i < 44; i++) {
          var diameter = this.diameter[i];
          var targetDiameter = this.targetDiameter[i];
          if (diameter <= 0) newLastObstruction = i;
          var slowReturn;
          if (i < this.noseStart) slowReturn = 0.6;
          else if (i >= this.tipStart) slowReturn = 1.0;
          else
            slowReturn =
              0.6 +
              0.4 * (i - this.noseStart) / (this.tipStart - this.noseStart);
          this.diameter[i] = moveTowards(
            diameter,
            targetDiameter,
            slowReturn * amount,
            2 * amount
          );
        }

        if (
          this.lastObstruction > -1 &&
          newLastObstruction == -1 &&
          this.noseA[0] < 0.05
        ) {
          this.addTransient(this.lastObstruction);
        }
        this.lastObstruction = newLastObstruction;

        amount = deltaTime * this.movementSpeed;
        this.noseDiameter[0] = moveTowards(
          this.noseDiameter[0],
          this.velumTarget,
          amount * 0.25,
          amount * 0.1
        );
        this.noseA[0] = this.noseDiameter[0] * this.noseDiameter[0];
      },

      calculateReflections: function() {
        for (var i = 0; i < 44; i++) {
          this.A[i] = this.diameter[i] * this.diameter[i]; //ignoring PI etc.
        }
        for (var i = 1; i < 44; i++) {
          this.reflection[i] = this.newReflection[i];
          if (this.A[i] == 0) this.newReflection[i] = 0.999;
          //to prevent some bad behaviour if 0
          else
            this.newReflection[i] =
              (this.A[i - 1] - this.A[i]) / (this.A[i - 1] + this.A[i]);
        }

        //now at junction with nose

        this.reflectionLeft = this.newReflectionLeft;
        this.reflectionRight = this.newReflectionRight;
        this.reflectionNose = this.newReflectionNose;
        var sum =
          this.A[this.noseStart] + this.A[this.noseStart + 1] + this.noseA[0];
        this.newReflectionLeft = (2 * this.A[this.noseStart] - sum) / sum;
        this.newReflectionRight = (2 * this.A[this.noseStart + 1] - sum) / sum;
        this.newReflectionNose = (2 * this.noseA[0] - sum) / sum;
      },

      calculateNoseReflections: function() {
        for (var i = 0; i < this.noseLength; i++) {
          this.noseA[i] = this.noseDiameter[i] * this.noseDiameter[i];
        }
        for (var i = 1; i < this.noseLength; i++) {
          this.noseReflection[i] =
            (this.noseA[i - 1] - this.noseA[i]) /
            (this.noseA[i - 1] + this.noseA[i]);
        }
      },

      runStep: function(glottalOutput, turbulenceNoise, lambda) {
        var updateAmplitudes = Math.random() < 0.1;

        //mouth
        this.processTransients();
        this.addTurbulenceNoise(turbulenceNoise);

        //this.glottalReflection = -0.8 + 1.6 * Glottis.newTenseness;
        this.junctionOutputR[0] =
          this.L[0] * this.glottalReflection + glottalOutput;
        this.junctionOutputL[44] = this.R[44 - 1] * this.lipReflection;

        for (var i = 1; i < 44; i++) {
          var r =
            this.reflection[i] * (1 - lambda) + this.newReflection[i] * lambda;
          var w = r * (this.R[i - 1] + this.L[i]);
          this.junctionOutputR[i] = this.R[i - 1] - w;
          this.junctionOutputL[i] = this.L[i] + w;
        }

        //now at junction with nose
        var i = this.noseStart;
        var r =
          this.newReflectionLeft * (1 - lambda) + this.reflectionLeft * lambda;
        this.junctionOutputL[i] =
          r * this.R[i - 1] + (1 + r) * (this.noseL[0] + this.L[i]);
        r =
          this.newReflectionRight * (1 - lambda) +
          this.reflectionRight * lambda;
        this.junctionOutputR[i] =
          r * this.L[i] + (1 + r) * (this.R[i - 1] + this.noseL[0]);
        r =
          this.newReflectionNose * (1 - lambda) + this.reflectionNose * lambda;
        this.noseJunctionOutputR[0] =
          r * this.noseL[0] + (1 + r) * (this.L[i] + this.R[i - 1]);

        for (var i = 0; i < 44; i++) {
          this.R[i] = this.junctionOutputR[i] * 0.999;
          this.L[i] = this.junctionOutputL[i + 1] * 0.999;

          //this.R[i] = clamp(this.junctionOutputR[i] * this.fade, -1, 1);
          //this.L[i] = clamp(this.junctionOutputL[i+1] * this.fade, -1, 1);

          if (updateAmplitudes) {
            var amplitude = Math.abs(this.R[i] + this.L[i]);
            if (amplitude > this.maxAmplitude[i])
              this.maxAmplitude[i] = amplitude;
            else this.maxAmplitude[i] *= 0.999;
          }
        }

        this.lipOutput = this.R[44 - 1];

        //nose
        this.noseJunctionOutputL[this.noseLength] =
          this.noseR[this.noseLength - 1] * this.lipReflection;

        for (var i = 1; i < this.noseLength; i++) {
          var w = this.noseReflection[i] * (this.noseR[i - 1] + this.noseL[i]);
          this.noseJunctionOutputR[i] = this.noseR[i - 1] - w;
          this.noseJunctionOutputL[i] = this.noseL[i] + w;
        }

        for (var i = 0; i < this.noseLength; i++) {
          this.noseR[i] = this.noseJunctionOutputR[i] * this.fade;
          this.noseL[i] = this.noseJunctionOutputL[i + 1] * this.fade;

          if (updateAmplitudes) {
            var amplitude = Math.abs(this.noseR[i] + this.noseL[i]);
            if (amplitude > this.noseMaxAmplitude[i])
              this.noseMaxAmplitude[i] = amplitude;
            else this.noseMaxAmplitude[i] *= 0.999;
          }
        }

        this.noseOutput = this.noseR[this.noseLength - 1];
      },

      finishBlock: function() {
        this.reshapeTract(self.blockTime);
        this.calculateReflections();
      },

      //modified: get strength from Tract.tIntensity
      addTransient: function(position) {
        var trans = {};
        trans.position = position;
        trans.timeAlive = 0;
        trans.lifeTime = 0.2;
        trans.strength = self.Glottis.intensity == 0 ? 0 : this.tIntensity;
        trans.exponent = 200;
        this.transients.push(trans);
      },

      processTransients: function() {
        for (var i = 0; i < this.transients.length; i++) {
          var trans = this.transients[i];
          var amplitude =
            trans.strength * Math.pow(2, -trans.exponent * trans.timeAlive);
          this.R[trans.position] += amplitude / 2;
          this.L[trans.position] += amplitude / 2;
          trans.timeAlive += 1.0 / (sampleRate * 2);
        }
        for (var i = this.transients.length - 1; i >= 0; i--) {
          var trans = this.transients[i];
          if (trans.timeAlive > trans.lifeTime) {
            this.transients.splice(i, 1);
          }
        }
      },

      /*
        *    Modified addTurbulenceNoise - instead of requiring UI touch, simulate it:
        *        Get "touch" index + diameter from smallest value in consonant diameters
        *        Diameter is incremented slightly 
        *            This places the "touch" slightly below the peak to mimic mouse
        *        Loudness of noise is set by Tract.fIntensity 
        */
      addTurbulenceNoise: function(turbulenceNoise) {
        var index = this.constrictionIndex;
        var diameter = this.constrictionDiameter;

        diameter += 0.295; //offset "touch" diameter from Tract peak
        if (index < 2 || index > self.Tract.n) return;
        if (diameter <= 0) return;

        var intensity = self.Tract.fIntensity;
        this.addTurbulenceNoiseAtIndex(
          0.66 * turbulenceNoise * intensity,
          index,
          diameter
        );
      },

      addTurbulenceNoiseAtIndex: function(turbulenceNoise, index, diameter) {
        var i = Math.floor(index);
        var delta = index - i;
        turbulenceNoise *= self.Glottis.getNoiseModulator();
        var thinness0 = clamp(8 * (0.7 - diameter), 0, 1);
        var openness = clamp(30 * (diameter - 0.3), 0, 1);
        var noise0 = turbulenceNoise * (1 - delta) * thinness0 * openness;
        var noise1 = turbulenceNoise * delta * thinness0 * openness;
        this.R[i + 1] += noise0 / 2;
        this.L[i + 1] += noise0 / 2;
        this.R[i + 2] += noise1 / 2;
        this.L[i + 2] += noise1 / 2;
      }
    };

    this.Glottis.init();
    this.Tract.init();
  }

  // based on code from pink trombone AudioContext.doScriptProcessor()
  process(inputs, outputs, params) {
    //update a bunch of object variables using audioparam values
    this.Glottis.UITenseness =
      params["tenseness"][0] * params["base-tenseness"][0];
    this.Glottis.UIFrequency = params["frequency"][0];
    this.Glottis.intensity = params["intensity"][0];
    this.Glottis.loudness = params["loudness"][0];
    this.Glottis.vibratoAmount = params["vibrato-amount"][0];
    this.Glottis.vibratoFrequency = params["vibrato-frequency"][0];
    this.Tract.velumTarget = params["velum-target"][0];
    this.Tract.noseDiameter[0] = params["velum-target"][0];
    this.Tract.fIntensity = params["fricative-intensity"][0];
    this.Tract.tIntensity = params["transient-intensity"][0];
    this.Tract.constrictionDiameter = params["constriction-diameter"][0];
    this.Tract.constrictionIndex = params["constriction-index"][0];

    //some voices dont't have inputs defined immediately (why?)
    if (!inputs[0][0]) return true; //output nothing (silence) until they're ready

    try {
      var inputArray1 = inputs[0][0];
      var inputArray2 = inputs[1][0];
      var outArrayL = outputs[0][0];
      var outArrayR = outputs[0][1];

      //get sample multiplier values according to pan value (-1 - 1)
      var panMultR = (1 + params["pan"][0]) / 2;
      var panMultL = 1 - panMultR;

      var panMax = Math.max(panMultL, panMultR);
      panMultR /= panMax;
      panMultL /= panMax;
      for (var j = 0, N = outArrayL.length; j < N; j++) {
        var lambda1 = j / N;
        var lambda2 = (j + 0.5) / N;
        var glottalOutput = this.Glottis.runStep(lambda1, inputArray1[j]);
        var vocalOutput = 0;
        this.Tract.runStep(glottalOutput, inputArray2[j], lambda1);
        vocalOutput += this.Tract.lipOutput + this.Tract.noseOutput;
        this.Tract.runStep(glottalOutput, inputArray2[j], lambda2);
        vocalOutput += this.Tract.lipOutput + this.Tract.noseOutput;
        var samp = vocalOutput * 0.125;

        //apply panning multiplers to L and R channels
        outArrayL[j] = samp * panMultL;
        outArrayR[j] = samp * panMultR;
      }
      this.Glottis.finishBlock();
      this.Tract.finishBlock();

      return true;
    } catch (e) {
      console.log(`error from voice #${this.voiceNum}:`, e);
      return false;
    }
  }
  processMessage(msg) {
    if ("d" in msg) {
      this.Tract.diameter = msg.d;
    }
    if ("td" in msg) {
      this.Tract.targetDiameter = msg.td;
    }
  }
}

registerProcessor("voice", VocalWorkletProcessor);
