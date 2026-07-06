import { CapacitorREST } from '@devioarts/capacitor-rest';

window.testEcho = () => {
    const inputValue = document.getElementById("echoInput").value;
    CapacitorREST.echo({ value: inputValue })
}
