async function redeemDino(steamid) {
    const res = await fetch('/api/dinostorage/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamid })
    });

    const data = await res.json();

    alert(data.success ? (data.message || "Dino redeemed successfully.") : ("Error: " + (data.error || "Failed to redeem dinosaur.")));
}