# React Pink Trombone
A modular, polyphonic refactorization of [Pink Trombone](https://dood.al/pinktrombone/) and a ```<Tract>``` component, for use in React apps.

## Installation
- ```git clone``` this repo into a desired location in your project directory, likely somewhere within ```src```. The project should have React installed already.

## Usage

### Adding AudioWorklet Modules
- Create a ```new AudioContext()``` or use an existing one. You may want to store it in a component state.
- Once the AudioContext is created, you must load the AudioWorklet modules, defined inside ```pink_trombone_processor.js```. You can do this inside a ```useEffect``` with the AudioContext state as a dependency.
  - If you cloned your repo into ```src```: ```await <yourAudioContext>.audioWorklet.addModule(new URL('path/to/pink_trombone_processor.js', import.meta.url));```
    - The above example is for projects using Vite. It may have to be changed for other React frameworks.
  - Adding AudioWorklet modules is often tricky. If the above doesn't work, you may move ```pink_trombone_processor.js``` and ```noise.js``` into your public folder and use ```await <yourAudioContext>.audioWorklet.addModule('path/to/pink_trombone_processor.js>);``` instead. __The path should be relative to the public directory!__
  - If the above doesn't work either, you may try ```import WorkletProcessor from "path/to/pink_trombone_processor.js?worklet&url``` and then ```await <audioCtx>.audioWorklet.addModule(WorkletProcessor)```
    
### RPT Voice(s)
The ```RPT_Voice``` class manages a single modular Pink Trombone voice, with methods for changing audio parameters and manipulating speech.

#### Initialization
- Create a ```new RPT_Voice(<name/number>, <yourAudioContext>, <audioDestination?>)```, or several. You may want to store it in a component state.
  - ```audioDestination``` is an optional ```AudioNode``` which the voice AudioWorklet will route its audio output to. It will default to the AudioContext destination.
  - Once a voice is created, enable audio processing with ```<voice>.connect()``` whe needed. When a voice is no longer needed, call ```<voice>.disconnect()``` to free up resources.
 
#### Glottis AudioParams
The Glottis module produces a raw "glottal source" - the sound produced by the vocal cords before being filtered by the vocal tract. Access Glottis parameters of a voice using ```<voice>.glottis.parameters.get(<param>)``` and use any AudioParam methods such as ```setTargetAtTime```, or write values to ```<AudioParam>.value``` directly.
- Timbral AudioParams - general timbral properties of the voice not used for speech generation:
  - ```frequency``` (in Hz) - the fundamental frequency of the voice
  - ```tenseness``` (float 0-1) - between 0, a breathy whisper; and 1, a harsh, strained tone. Default and "natural" voice is around 0.6.
  - ```vibrato-frequency``` (in Hz) - the frequency of a sine wave that modulates the voice frequency to create a vibrato effect.
  - ```vibrato-amount``` - the amplitude of the vibrato sine wave. Units unknown? A typical vibrato amount is around 0.025.
- Speech AudioParams - manipulated over time to create speech:
  - ```intensity``` (float 0-1) - the volume of the pitched component of the voice. Generally stays at 1, but should drop to 0 for unpitched consonants such as S or F. This isn't (exactly) gain!! Use ```<voice>.setGain``` to set the gain on the entire voice.
  - ```tenseness-mult``` (float 0-1) - a multiplier of the tenseness parameter, used to scale the final tenseness between 0 and the base tenseness value.
  - ```pitchbend``` (in semitones, not necessary for speech) - bends the fundamental frequency up/down the specified # of semitones.

#### Tract AudioParams
The Tract module filters the glottal source output by the Glottis using several parameters modeled after the human vocal tract. Access Tract parameters of a voice using ```<voice>.tract.parameters.get(<param>)``` and use any AudioParam methods, or write to ```<AudioParam>.value``` directly.
- Timbral AudioParams - general properties of the vocal tract, not used during speech generation:
  - ```n``` (int) - the length of the vocal tract, in segments. Default "male" length is 44. Shortening the tract will produce gradually "younger", more "feminine" voices.
    - If using a corresponding Tract UI component, use ```<voice>.setN(<n>)``` instead of writing the parameter value directly to update the UI visuals as well.
- Speech AudioParams - manipulated over time to create speech:
  - ```tongue-index``` + ```tongue-diameter``` - the index + diameter of the tongue position, relevant for vowel production. In the GUI, these are manipulated by dragging the pink circle around the "tongue control" area.
  - ```constriction-index``` + ```constriction-diameter``` - the index + diameter of the tongue constriction, relevant for producing most consonants. In the GUI, these are manipulated by clicking/dragging around the "oral cavity" area.
  - ```lip-diameter``` - the diameter of the opening of the lips, used for producing O and U vowels.
  - ```velum-target``` (float 0.01 - 0.4, in cm?) - the width of the velum, which connects the oral and nasal tracts. Generally stays closed but opens for nasal consonants such as N and M.
  - ```fricativess``` (float 0+) - the volume of fricatives, white noise produced by tight tongue constrictions for consonants such as S and V.
  - ```transients``` (float 0-1) - the volume of transients, short clicks produced by the tongue when leaving the roof of the mouth
  - ```movement-speed``` (float 0+, not required for speech) - the speed with which the tract measurements smoothly approach their target values. Set to a negative number for instant or 0 to freeze.

#### Gain + Pan
  - Use ```<voice>.setGain(gain)``` to set the gain (volume) of the voice (0 for silent, 1 for default, 1+ to amplify)
  - Use ```<voice>.setPanning(pan)``` to set the stereo panning of the voice (-1 for L -> 1 for R, 0 for center)

### Tract UI Component
The ```<Tract>``` component renders a single interactive tract UI that looks and behaves almost identically to the one found in the original Pink Trombone.
- Add a ```<Tract voice={<voice>} <reportVowel?> />``` component anywhere in your component tree. Props:
  - voice: the ```RPT_Voice``` object the tract UI should be linked to
  - reportVowel (boolean - optional): report current tongue index + diameter on hover if true, or not if false/omitted