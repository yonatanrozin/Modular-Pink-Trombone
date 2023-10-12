import {voices, ctxInitiated} from './MPT/pink_trombone_script.js';

//UI DOM objects per studio mode
const controls = {
    voice: document.getElementById('voiceOptions'),
    excitation: document.getElementById('excitationOptions')
};

//studio canvas for graphics and input
const studioCanvas = document.getElementById('studioCanvas');
const ctx = studioCanvas.getContext('2d');

// studio mode: get from selection
let studioMode;
document.getElementById('studioModeSelect').oninput = function (e) {
    for (let c of document.getElementsByClassName('studioControl')) c.style.display = 'none';
    studioMode = e.target.value;
    if (controls[studioMode]) controls[studioMode].style.display = 'block';
}

//slider for changing voiec frequency
document.getElementById('frequencySlider').oninput = function (e) {
    if (!voices[0]) {
        console.log('nope.'); return;
    }
    voices[0].setFrequency(e.target.value);
    document.getElementById('frequencyValue').innerHTML = e.target.value;
}
//slider for changing voice tenseness
document.getElementById('tensenessSlider').oninput = function (e) {
    if (!voices[0]) {
        console.log('nope.'); return;
    }
    voices[0].glottis.parameters.get('base-tenseness').value = e.target.value;
    document.getElementById('tensenessValue').innerHTML = e.target.value;
}

document.getElementById('eqArrayInput').oninput = function(e) {
    let arrParsed
    try {arrParsed = JSON.parse(e.target.value)}
    catch (e) {console.log('invalid array literal provided')}

    for (let i in arrParsed) {
        voices[0].filters[i].gain.value = arrParsed[i]
    }
}

//copy EQ array to clipboard
document.getElementById('getEQButton').onclick = function() {
    if (!ctxInitiated) {
        console.log('voices not initialized.');
        return;
    }
    navigator.clipboard.writeText(
        JSON.stringify(voices[0]?.filters.map(f => Number(f.gain.value.toFixed(2))))
    );
}

document.getElementById('excitationCopyButton').onclick= function() {
    if (!ctxInitiated) return;
    navigator.clipboard.writeText(JSON.stringify(voices[0].excitation.map(v => Number(v.toFixed(3)))))
};

document.getElementById('excitationSmoothButton').onclick = function() {
    if (!ctxInitiated) return;
    const exc = voices[0].excitation

    let val = null
    for (let i in exc) {
        if (val == null) val = exc[i]
        else val = val*.5 + exc[i]*.5

        exc[i] = val
    }

    voices[0].glottis.port.postMessage({exc: exc})
}

document.getElementById('excitationInput').oninput = (e) => {
    if (!ctxInitiated) return;
    voices[0].glottis.port.postMessage({exc: JSON.parse(e.target.value)});
}

let frameILast;
//studio canvas mouse interactions according to studio mode
studioCanvas.addEventListener('mousemove', (e) => {
    if (!e.buttons || !ctxInitiated) {
        frameILast = undefined;
        return;
    }
    
    const x = e.offsetX / e.target.width;
    const y = e.offsetY / e.target.height;

    //change voice filters
    if (studioMode == 'voice') {
        if (!voices[0]) return;
        const filterI = Math.floor(x * voices[0].glottisFilters.length);
        const fNew = y * -20 + 10;
        console.log(filterI, voices[0].glottisFilters.length, fNew)
        if (voices[0].glottisFilters[filterI]) voices[0].glottisFilters[filterI].gain.value = fNew;
    } 
    
    else if (studioMode == "tract") {
        if (!ctxInitiated) return;

        const i = Math.round(e.offsetX/e.target.width * (voices[0].tractDiameters.length));
        const dia = (1-(e.offsetY/e.target.height))*5
        const diameters = voices[0].tractDiameters;
        diameters[i] = dia

        voices[0].port.postMessage({
            d: diameters,
            td: diameters
        });
    } else if (studioMode == "excitation") {
        const exc = voices[0].excitation;

        if (!exc) return;

        let i = Math.floor(e.offsetX/e.target.width*(exc.length-1))
        let a = (1-e.offsetY/e.target.height)*2 - 1

        exc[i] = a;

        voices[0].glottis.port.postMessage({exc, exc})
    }
})

//draw graphics on studio canvas
function draw() {
    if (!ctxInitiated) {
        requestAnimationFrame(draw);
        return;
    };
    
    ctx.clearRect(0, 0, studioCanvas.width, studioCanvas.height);

    //draw voice filter EQ bands + value labels
    if (studioMode == 'voice') {
        const filters = voices[0].glottisFilters.map(f => f.gain.value);
        ctx.font = `12px Helvetica`;
        for (let i in filters) {
            ctx.beginPath();
            const x = studioCanvas.width / filters.length * i;
            const h = (filters[i] + 10) / 20 * studioCanvas.height; //map(filters[i], -10, 10, 0, studioCanvas.height);
            ctx.fillStyle = `rgb(0, 0, ${i / (filters.length - 1) * 255})`;
            ctx.fillText(filters[i].toFixed(1), x + 5,
                studioCanvas.height - h - 10);
            ctx.fillRect(x, studioCanvas.height, studioCanvas.width / filters.length, -h);
            ctx.stroke();
        }
    }

    else if (studioMode == 'tract') {
        if (!voices[0].tractDiameters) return;

        ctx.beginPath();
        for (let i in voices[0].tractDiameters) {
            let x = i/(voices[0].tractDiameters.length-1) * ctx.canvas.width;
            let y = ctx.canvas.height - voices[0].tractDiameters[i]/5 * ctx.canvas.height;

            if (i == 0) ctx.moveTo(x, y);
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    else if (studioMode == 'excitation') {
        
        const exc = voices[0].excitation;

        ctx.beginPath();
        for (let i in exc) {
            let x = i/(exc.length-1) * ctx.canvas.width;
            let y = ctx.canvas.height - (exc[i]+1)/2 * ctx.canvas.height

            if (i == 0) ctx.moveTo(x, y)
            ctx.lineTo(x, y)
        }
        ctx.stroke()
    }

    requestAnimationFrame(draw)
}
window.requestAnimationFrame(draw)