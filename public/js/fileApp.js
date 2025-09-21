"use strict";

const queryText = location.search;
const successQuery = queryText.startsWith("?success=");
if (successQuery) {
    const successPanel = document.getElementById('successPanel');
    successPanel?.style.removeProperty('display');

    const fileSuccessName = document.getElementById('fileSuccessName');
    fileSuccessName.innerText = decodeURIComponent(queryText.substring(9));

} else if (queryText.startsWith("?error=")) {
    const errorPanel = document.getElementById('errorPanel');
    errorPanel?.style.removeProperty('display');
}

const fileToUploadBtn = document.getElementById('file-to-upload-btn');

document.body.ondragover = (event) => {
    event.preventDefault();
    event.stopPropagation();
    fileToUploadBtn.style.zIndex = 999999;
    fileToUploadBtn.style.position = "fixed";
    fileToUploadBtn.style.left = (event.pageX - 50) + "px";
    fileToUploadBtn.style.top = (event.pageY - 10) + "px";

};

const fixButtonBack = () => {
    delete fileToUploadBtn.style.position;
    delete fileToUploadBtn.style.left;
    delete fileToUploadBtn.style.top;
    delete fileToUploadBtn.style.zIndex;
}
document.body.ondragend = fixButtonBack;
document.body.ondragexit = fixButtonBack;
document.body.ondragleave = (event) => {
    if (event.target == fileToUploadDom
        || event.pageX <= 10 || event.pageX >= window.innerWidth - 10
        || event.pageY <= 10 || event.pageY >= window.innerHeight - 10) {
        fixButtonBack();
    }
}
document.body.ondrop = (event) => {
    fixButtonBack();
    event.preventDefault();
    event.stopPropagation();
    document.body.classList.add("uploading");

    fileToUploadDom.files = event.dataTransfer.files;

    setTimeout(() => {
        fileToUploadDom.form.submit();
    }, 1);
}


const fileToUploadDom = document.getElementById('file-to-upload');
fileToUploadDom.value = null;
fileToUploadDom.onchange = (event) => {
    event.stopPropagation();
    event.preventDefault();
    document.body.classList.add("uploading");
    setTimeout(() => {
        fileToUploadDom.form.submit();
    }, 10);
}

function deleteFile(fileName) {
    if (!confirm("File '" + fileName + "' will be deleted. Are you sure?")) {
        return;
    }
    const request = new XMLHttpRequest()
    request.open('DELETE', `/files/${fileName}`, true)
    request.send();
    getFileList();
}

window.history.pushState('obj', document.title, `http://${location.host}${location.pathname}`);