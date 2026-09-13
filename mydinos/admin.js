async function runAdmin() {
    const cmd = document.getElementById("cmd").value;

    const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
    });

    const data = await res.json();

    document.getElementById("output").innerText =
        data.success ? data.rcon : data.error;
}