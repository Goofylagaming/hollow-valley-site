async function runAdmin() {
    const cmd = document.getElementById("cmd").value;
    if (!cmd) return alert("Please enter an RCON command");

    const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
    });

    const data = await res.json();

    document.getElementById("output").innerText =
        data.success ? (data.rcon || "Command executed.") : ("Error: " + (data.error || "Failed to run command."));
}