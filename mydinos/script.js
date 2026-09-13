async function parkDino(steamid) {
    const res = await fetch('/api/park', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamid })
    });

    const data = await res.json();

    if (data.success) {
        alert("Your dinosaur has been parked.");
    } else {
        alert("Error: " + (data.error || "Failed to park dinosaur."));
    }
}
