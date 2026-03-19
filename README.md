# React Pink Trombone
A modular, polyphonic refactorization of [Pink Trombone](https://dood.al/pinktrombone/) and an interactive ```<Tract>``` UI component for use in React apps.

Tested with:
- Typescript 5.5.4
- Vite 5.4.21
- Firefox 
- Chrome _when compiled with Vite build target ```esnext```_

## Installation
- ```git clone``` this repo into a desired location in your project directory, likely somewhere within ```src```. The project should have React installed with TypeScript already.

## Usage

### Adding AudioWorklet Modules
- Create a ```new AudioContext()``` or use an existing one.
- Load the custom AudioWorklet modules with ```await addRPT(ctx)```
  - Be sure to only do this once! (i.e. inside a useEffect)
    
### Creating voice(s)
- Create a ```new RPT(audioCtx, autoConstrictions)``` to create a complete Pink Trombone voice with a glottis and tract and connections handled automatically.
- Alternatively, create a ```new RPTTractNode(ctx, autoConstrictions)``` to create a tract module that can filter a custom audio source (for a vocoder-like effect)
- Use ```<RPT>.connect(destination)``` to connect your voice to your target audioNode
  - Be sure to use ```<RPT>.disconnect()``` to stop the audio processing when voice is no longer needed!
- See Tract module info below for information about ```autoConstrictions```
 
### Glottis module

The Glottis module produces a raw "glottal source" - the sound produced by the vocal cords before being filtered by the vocal tract. This sound on its own is very unnatural, and will typically be immediately filtered by the vocal tract. You can create a Glottis module by itself with ```new RPTGlottisNode(audioCtx)``` but it's almost always better to just create a ```new RPT(audioCtx)```, which has a glottis and tract module included.

#### AudioParams

Access glottis params with ```<RPT/RPTGlottisNode>.<name>``` and use it like any other AudioParam - write to its ```value``` property directly or (recommended:) use AudioParam methods such as ```setTargetAtTime``` and ```setValueAtTime```

Timbral Audioparams - these should be used to adjust the timbral properties of the voice, and should generally not be manipulated for the purpose of speech generation:

- ```frequency``` (float, in Hz) - the fundamental frequency of the voice
- ```tenseness``` (float 0-1) - between 0, a breathy whisper; and 1, a harsh, strained tone. Default and "natural" voice is around 0.6.

Speech-related AudioParams - these can be manipulated over time to create speech:

- ```intensity``` (float 0-1) - the volume of air flow produced by the voice, which affects volume of pitched component of the voice, as well as aspiration and fricative noise. 
    - Don't treat this as a voice gain value! Use ```<RPT>.gain``` to set the gain on the entire voice or create a GainNode manually and adjust it's gain AudioParam.
- ```tenseness-scale``` (float 0-1) - a multiplier of the tenseness parameter, used to scale the final tenseness between 0 and the base tenseness value. 
  - Don't use this as the voice's general resting tenseness - use the ```tenseness``` param instead
  <!-- - ```pitchbend``` (in semitones, optional, default 0) - bends the fundamental frequency up/down a specified # of semitones (half-steps) -->

### Tract Module

The Tract module filters a glottal source, typically outputted by a Glottis module, but can be used with any custom audio source for a vocoder-like effect. A Tract module can be created with ```new RPTTractModule(audioCtx, autoConstrictions)``` if you want to connect a custom audio source yourself, but in most cases you can create a ```new RPT(audioCtx, autoConstrictions)```, which includes a Glottis and Tract module automatically.

#### autoConstrictions (boolean)
- True - default Pink Trombone behavior: tongue & constriction index/diameter audioParam values will reshape the vocal tract diameters automatically. Constriction index + diameter params will additionally affect the timbre of fricative white noise, when present
- False - manual control: tract diameters are set manually with ```<RPT/RPTTractModule>.setDiameters(Float64Array)```. Tongue index/diameter values have no effect. Constriction index/diameter values have no effect on the tract shape but still affect white noise and must be calculated manually (typically using the _normalized_ position and value of the smallest tract diameter)

#### Tract Diameters

Use ```RPT/RPTTractModule.setDiameters(<Float64Array>)``` to manually set the tract diameter values used by this tract. This is typically only done when autoConstrictions is disabled to manually create speech.
- AutoConstrictions == true: this will only affect the "rest diameter" - the base diameter values onto which the tongue position and constrictions are overlaid according to AudioParam values
- AutoConstrictions == false: this will set the voice's final diameters, with (presumably) tongue values included

#### Params

Access tract params with ```<RPT/RPTTractNode>.<name>``` and use it like any other AudioParam - write to its ```value``` property directly or (recommended:) use AudioParam methods such as ```setTargetAtTime``` and ```setValueAtTime```

Timbral AudioParams - general properties of the vocal tract, not used during speech generation:

- ```n``` (int, default 44) - the length of the vocal tract, in segments. Default "male" length is 44. Manipulating the length will primarily affect vowel formants and can be used (along with other audioParams) to adjust the percieved "gender" and age of the voice.

Speech AudioParams - manipulated over time to create speech:

- ```tongue-index``` & ```tongue-diameter``` - the index + diameter of the tongue position, relevant for vowel production. In the GUI, these are manipulated by dragging the pink circle around the "tongue control" area.
  - Tongue index is __normalized__ between 0 - 1, representing the left- and right-most sides of the tongue control area. Tongue diameter is always between 2.05 and 3.5, where higher numbers are LOWER in the tongue control area.
  - _No effect if autoConstriction is false_
- ```constriction-index``` & ```constriction-diameter``` - the index + diameter of the tongue constriction, relevant for producing most consonants. In the GUI, these are manipulated by clicking/dragging around the "oral cavity" area.
  - Constriction index is __normalized__ between 0 and 1, representing the complete length of the oral tract, where 0 is at the throat and 1 is at the opening of the lips.
  - Set to 0 for no constriction
  - _No effect on tract diameters if autoConstriction is false_ but will still affect fricative noise! This can generally be set to the normalized position and value of the smallest tract diameter (unless it's in the throat)
- ```velum-target``` (float 0.01 - 0.4, in cm) - the width of the opening of the velum, which connects the oral and nasal tracts. Closed by default but opens for nasal consonants such as N and M.
- ```movement-speed``` (float 0+ in cm/s?, not required for speech) - the speed with which the final tract measurements smoothly approach their target values. Default is 15. Set to a negative number for instant (not recommended) or 0 to freeze the tract at its current shape.

### Gain

Reference the gain AudioParam of a built-in GainNode with ```<RPT>.gain```. If you're using an independent Glottis/Tract module, you'll have to create and connect the GainNode manually.

### Tract UI Component
The ```<Tract>``` component renders a single interactive tract UI that looks and behaves almost identically to the one found in the original Pink Trombone and automatically manipulates voice parameters and diameters in response to mouse interaction.
- With an RPT voice created, render a ```<RPT.UIComponent />``` in your DOM. 
  - Use ```<RPT.UIComponent keyboard/>``` to render the UI with the interactive frequency/tenseness keyboard
- Tract diameters will NOT response to mouse events if autoconstrictions was set to false in the voice constructor.