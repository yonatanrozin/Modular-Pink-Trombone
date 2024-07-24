import { MPT_Voice } from "../src/pink_trombone_script.js";

let voices = [];
window.voices = voices;

//create audioContext
const ctx = new AudioContext();
window.ctx = ctx;

//load pink trombone audio modules and create voices
//voices can only be created once the audio modules have been loaded!
ctx.audioWorklet.addModule("../src/pink_trombone_processor.js")
    .then(() => { 
        //create a voice and pass reference to an HTML canvas to render GUI
        voices.push(new MPT_Voice("voice1", ctx, document.getElementById("tract1Canvas")));

        //or render a "headless" voice (no GUI, must use audioParams to interface)
        voices.push(new MPT_Voice("voice2", ctx));
        // document.getElementById("tracts").appendChild(voices[1].UI.cnv) //to attach a headless voice to a cnv later

        //connect your voices to destinations
        voices[0].connect(ctx.destination);
        voices[1].connect(ctx.destination);
    }
);

document.getElementById("MPTVoicesInitButton").addEventListener("click", () => {
    ctx.resume();
});

function draw() {
    for (let v of voices) {
        v.UI.draw();
    }
    requestAnimationFrame(draw);
}
requestAnimationFrame(draw);