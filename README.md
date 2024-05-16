# React Pink Trombone
A modular, polyphonic refactorization of [Pink Trombone](https://dood.al/pinktrombone/) and a ```<Tract>``` component, for use in React apps.

## Installation
- ```git clone``` this repo into a desired location in your project directory, likely somewhere within ```src```

## Usage

### Adding AudioWorklet Modules
- Create a ```new AudioContext()``` or use an existing one. You may want to store it in a component state.
- Once the AudioContext is created, you must load the AudioWorklet modules, defined inside ```pink_trombone_processor.js```. You can do this inside a ```useEffect``` with the AudioContext state as a dependency.
  - If you cloned your repo into ```src```: ```await <yourAudioContext>.audioWorklet.addModule(new URL('<path/to/pink_trombone_processor.js>', import.meta.url));```
    - The above example is for projects using Vite. It may have to be changed for other React frameworks.
  - Alternatively, move ```pink_trombone_processor.js``` into your public folder and use ```await <yourAudioContext>.audioWorklet.addModule('<path/to/pink_trombone_processor.js>');```
    - __The path used in this example should be relative to the public directory!__
    
### RPT Voice(s)
The ```RPT_Voice``` class manages a single modular Pink Trombone voice, with methods for changing audio parameters and manipulating speech.

#### Initialization
- Create a ```new RPT_Voice(<name/number>, <yourAudioContext>, <audioDestination?>)```, or several. You may want to store it in a component state.
  - ```audioDestination``` is an optional ```AudioNode``` which the voice AudioWorklet will route its audio output into. It will default to the AudioContext destination.
  - Once a voice is created, enable audio processing with ```<voice>.connect()``` whe needed. When a voice is no longer needed, call ```<voice>.disconnect()``` to free up resources.

### Tract
The ```<Tract>``` component renders a single interactive tract UI that looks and behaves almost identically to the one found in the original Pink Trombone.
- Add a ```<Tract>``` component anywhere in your component tree. Props:
  - ```voice```: the ```RPT_Voice``` object the tract UI should be linked to.
  - ```canvasRef```: a React ```useRef``` containing an HTML ```<canvas>``` element the UI graphics should render to.
