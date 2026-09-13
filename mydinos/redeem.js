async function redeemDino(steamid) {
    const res = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamid })
    });

    const data = await res.json();

    alert(data.success ? "Dino redeemed." : data.error);
}