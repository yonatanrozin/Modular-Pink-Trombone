# Modular Pink Trombone
A modular, audio-only version of Pink Trombone optimized for use in live performance. Features significantly faster and non-blocking audio processing and the ability to produce multiple simultaneous voices.

## Notice
This patch is based heavily and exclusively on the original [Pink Trombone](https://dood.al/pinktrombone/), created by Neil Thapen and released under the [MIT License](https://opensource.org/license/mit). As per the license requests, a copy of the original code and license are included in this repository.

__This code is functional on Chrome and Firefox. Other browsers have not yet been tested.__

## Modifications from original
- The deprecated ```ScriptProcessorNode``` used in the original Pink Trombone has been replaced with new Web Audio API ```AudioWorkletNode```s. This allows the audio processing to run in a dedicated thread, preventing the it from interfering with the rest of the script, or vice versa.
  - The Pink Trombone variables ```Tract``` and ```Glottis``` have been reimplemented as new Web AudioWorkletProcessor classes ```GlottisProcessor``` and ```TractProcessor```. This allows multiple voice objects, each with its own processors, to run simultaneously. You can create an entire Pink Trombone chorus (maximum voice count depends on CPU capabilities)!

## Installation
- ```git clone``` this repo into your project folder

## Voice Setup
- In your script, create a ```new AudioContext()``` or use an existing one (if integrating into an existing project)
- ```<audioCtx>.audioWorklet.addModule(<path/to/src/pink_trombone_processor.js>)```
  - The specific URL to use inside addModule() may be tricky to figure out. The path may have to be relative to your project's html file, NOT necessarily relative to the script.
  - addModule is an async function. Use ```.then()``` or ```await``` to create your voices after the modules are loaded.
- Create ```new MPT_Voice()```s. The number of active voices at a time depends on your CPU. If the limit is exceeded, audible "pops" in the sound will begin to occur.
  - Voices must be created AFTER the audio modules are loaded! Since addModule is an async function, wait until the promise is resolved to create your voice(s).
  - Pass in a name (any), a reference to your AudioContext and an optional reference to an HTML canvas element.
    - If you pass an HTMLCanvas, an interactive GUI will be rendered to that canvas which you can use to control the voice. If no canvas is specified, the voice will be "headless" (no GUI, but can still produce sound and be manipulated with audioParams)
      - You may add a headless voice to the DOM later using ```<HTMLElement>.appendChild(<voice>.UI.cnv)```
- Connect your voice(s) using ```<voice>.connect(destinationNode)```. The destination can be another AudioNode for further audio processing, or the AudioContext.destination.
  - Use ```<voice>.disconnect()``` to disconnect a voice from the audio network.

## Usage
Controlling the voice is done through a series of AudioParams on the voice's Glottis and Tract AudioWorklets and GainNode. These internal nodes are all Web Audio AudioNodes. Their AudioParams can be written to directly by setting their ```.value``` property, or can be adjusted smoothly using AudioParam methods such as ```setTargetAtTime```, etc.

Most (but not all) glottis processor AudioParams are timbral properties which affect the overall quality of the voice, such as frequency, tenseness and vibrato. These should be set beforehand. On the other hand, most (but not all) tract processor AudioParams are parameters modeled after a physical mouth, such as tongue and lip position. These get manipulated in real-time to produce speech.

### Gain
- Access the voice's gain AudioParam with ```<voice>.gainNode.gain```
- Or use ```<voice>.setGain(gainValue)``` to set the value directly

### Glottis AudioParams
Access using ```<voice>.glottis.parameters.get(<paramName>)```. These are all timbral properties that should be set in advance, except for tenseness-mult, which is adjusted during speech production.
- frequency (in Hz) - sets the fundamental frequency of the voice
  - Can also be set using ```<voice>.setFrequency(<freq>)```
- intensity (0-1) - the volume of the pitched component of the voice
- tenseness (0-1) - a timbral quality ranging from an unpitched whisper (0) to a harsh, strained tone (1)
- tenseness-mult (0-1) - scales the final tenseness value from 0-tenseness. Manipulated during speech production.
- vibrato-amount (unit??) - sets the amploitude of vibrato, an LFO that modulates the fundamental frequency of the voice. Should be a really small number (0.005 default, anything >0.05 will start to sound ridiculous)
- vibrato-frequency (in Hz) - sets the frequency of vibrato
- pitchbend (in half-steps) - bends the fundamental frequency of the voice up/down the specified number of half steps. Recommended to use ```setTargetAtTime``` for the smoothest effect.

### Tract AudioParams
Access using ```<voice>.tract.parameters.get(<paramName>)```. These are all properties that are adjusted in real-time to produce speech, except for n, which is a timbral property that should be set in advance.
- n (int) - sets the length of the tract, in segments. Default is 44, smaller values produce "younger", more "feminine" voices but anything below 38 will start to sound alien
  - __Set this using ```<voice>.setN(<n>)```! if using a GUI__ instead of writing to AudioParam value directly!
Tongue audioParams - set the position of the base of the tongue. These are used to produce various vowel sounds (A, E, I, etc.)
- tongue-index (float) - the horizontal position (as a segment #) of the base of the tongue. Moves the tongue forwards and backwards in the "mouth" (left/right in the GUI)
  - For a tract of default length 44, the tongue index stays between 12 and 29. Scale these numbers down in shorter tracts
- tongue-diameter (2.05-3.5) - the vertical position of the tongue. Range stays the same regardless of tract size.
- lip-diameter (0-1.5) - sets the width of the opening of the mouth, used to produce vowels such as O and U. At 0, the mouth is closed.
Constriction audioParams - set the position of the tip of the tongue, which constricts the flow of air at different points to produce consonants
- constriction-index (float 0-n) - the horizontal position (as a segment #) of the tip of the tongue. Moves the tongue forward and backwards in the "mouth" (left/right in the GUI)
- constriction-diameter (float 0-5) - the vertical position of the tip of the tongue. 
  - At 0, the tongue is touching the roof of the mouth, which will block air flow entirely and cause silence
  - At values >0 and <0.3, the narrow constriction causes air turbulence, producing white noise characteristic of vowels such as S and F
- velum-target (0.01-0.4) - sets the width of the velum, a narrow passageway between the oral and nasal tracts. Closed (0.01) by default but is opened during the production of consonants where the oral tract is closed, such as M, N or NG
- movement-speed - the speed at which the tongue/constriction/lips positions move towards their target values. 15 by default but can be reduced to produce sloowwweerrrrr sspeeeechhh