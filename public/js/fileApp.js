"use strict";

function deleteFile(fileName) {
    if (!confirm("Are you sure?")) {
        return;
    }
    const request = new XMLHttpRequest()
    request.open('DELETE', `/files/${fileName}`, true)
    request.send();
    getFileList();
}

const queryText = location.search;
window.history.pushState('obj', document.title, "http://" + location.host + location.pathname);

const successIndex = queryText.startsWith("?success=");
if (successIndex) {
    const successPanel = document.getElementById('successPanel');
    successPanel?.style.removeProperty('display');

    const fileSuccessName = document.getElementById('fileSuccessName');
    fileSuccessName.innerText = decodeURIComponent(queryText.substring(9));

} else if (queryText.startsWith("?error=")) {
    const errorPanel = document.getElementById('errorPanel');
    errorPanel?.style.removeProperty('display');
}

const fileToUploadBtn = document.getElementById('fileToUploadBtn');

document.body.ondragover = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const x = event.pageX;
    const y = event.pageY;

    fileToUploadBtn.style.position = "fixed";
    fileToUploadBtn.style.top = (y - 11) + "px";
    fileToUploadBtn.style.left = (x - 40) + "px";

};

const fixButtonBack = () => {
    fileToUploadBtn.style.position = "static";
}
document.body.ondragend = fixButtonBack;
document.body.ondragexit = fixButtonBack;
document.body.ondragleave = (e) => {
    if (e.target == fileToUpload
        || e.pageX <= 10 || e.pageX >= window.innerWidth - 10
        || e.pageY <= 10 || e.pageY >= window.innerHeight - 10) {
        fixButtonBack();
    }
}
document.body.ondrop = (event) => {
    fixButtonBack();
    event.preventDefault();
    event.stopPropagation();
    document.body.classList.add("success");
    setTimeout(() => {
        fileToUpload.form.submit();
    }, 1);
}


const fileToUpload = document.getElementById('fileToUpload');
fileToUpload.value = null;
fileToUpload.onchange = (event) => {
    event.stopPropagation();
    event.preventDefault();
    document.body.classList.add("success");
    setTimeout(() => {
        fileToUpload.form.submit();
    }, 1);
}