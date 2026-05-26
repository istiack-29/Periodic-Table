document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

document.addEventListener("dragstart", (e) => {
  e.preventDefault();
});

document.addEventListener("keydown", (e) => {

  // CTRL + C
  if (e.ctrlKey && e.key === "c") {
    e.preventDefault();
  }

  // CTRL + U
  if (e.ctrlKey && e.key === "u") {
    e.preventDefault();
  }

  // CTRL + S
  if (e.ctrlKey && e.key === "s") {
    e.preventDefault();
  }

  // CTRL + SHIFT + I
  if (e.ctrlKey && e.shiftKey && e.key === "I") {
    e.preventDefault();
  }

  // F12
  if (e.key === "F12") {
    e.preventDefault();
  }

});

setInterval(() => {

  if (
    window.outerWidth - window.innerWidth > 160 ||
    window.outerHeight - window.innerHeight > 160
  ) {

    document.body.innerHTML = `
      <div style="
        background:black;
        color:white;
        height:100vh;
        display:flex;
        justify-content:center;
        align-items:center;
        font-size:30px;
        font-family:sans-serif;
      ">
        Developer Tools Detected
      </div>
    `;

  }

}, 1000);