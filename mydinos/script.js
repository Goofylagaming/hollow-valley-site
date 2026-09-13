async function parkDino(steamid) {
    const res = await fetch('/api/park', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamid })
    });

    const data = await res.json();

    alert(data.success ? "Dino parked." : data.error);
}