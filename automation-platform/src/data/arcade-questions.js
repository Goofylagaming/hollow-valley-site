"use strict";

// Server-side Arcade pools. Do not send this module to the browser.
// Each row is [prompt, answer, wrong option, wrong option].
// Facts are stable Isle Evrima identities or published Hollow Valley guide copy.
// No growth times, damage, diet percentages, crate odds, coin amounts or pack limits.

const trivia = [
  ["Which game does Hollow Valley run?", "The Isle: Evrima", "The Isle: Legacy", "A browser-only dinosaur game"],
  ["Which map does Hollow Valley use?", "Gateway", "Thenyaw", "Isla Nublar"],
  ["Where do you find Hollow Valley in the server browser?", "Unofficial Servers, after switching the game to Evrima", "Official Isle servers only", "The store page for a different game"],
  ["Which account should you use to sign in on the Hollow Valley website?", "The same Steam account you play with", "A different Steam account from the one you play with", "Only Discord, with no Steam link"],
  ["What does Dino Storage keep for a parked dinosaur?", "Species, growth, mutations, Prime state, skin and diet", "Only the species name", "A public copy other players can redeem"],
  ["What should you do before redeeming a stored dinosaur?", "Spawn on Hollow Valley as that dinosaur's species", "Redeem it from the Live Map without spawning", "Buy the dinosaur again from the Marketplace"],
  ["Dino Storage on Hollow Valley is:", "Free for every player", "Locked until you buy a membership", "Limited to one dinosaur per week"],
  ["When do daily quests reset?", "Midnight Brisbane time", "Friday at 4 pm Brisbane time", "Only after a server wipe"],
  ["When do weekly quests reset?", "Monday at midnight Brisbane time", "Saturday at 7 pm Brisbane time", "They never reset"],
  ["Where do Valley Coins from quests and playtime show up?", "In your Wallet", "On a public page next to your Steam ID", "Inside a sanctuary zone"],
  ["Dino School usually meets:", "Fridays at 4 pm Brisbane time", "Monday at midnight", "Only during a server wipe"],
  ["Before a Dino School session you should:", "Check the Events listing or Discord for the time, meeting point and any dinosaur requirements", "Assume every species and growth is allowed", "Pay Valley Coins to unlock the lesson"],
  ["Weekend community events on Hollow Valley are usually listed for:", "Saturdays at 7 pm Brisbane time", "Every weekday at dawn", "Official Isle servers only"],
  ["While the Live Map tab is active and tracking is available, positions refresh about:", "Every five seconds", "Once a day", "Only after your dinosaur dies"],
  ["On a desktop Live Map, how do you drop a private target pin?", "Hold Shift and click the map", "Post the coordinates in public chat", "Click another player's name"],
  ["Which of these can be turned on as Hollow Valley Live Map layers?", "Sanctuaries, patrol zones and migration zones", "Other players' private target pins", "A list of Steam IDs"],
  ["A sanctuary visit is recorded on the Hollow Valley tracker when:", "A position sample lands inside a mapped sanctuary", "You type a code in chat", "You open an Arcade crate"],
  ["Migration footprints on the Hollow Valley map mean:", "The tracker saw a visit. Only the game confirms a completed migration", "You are automatically a Prime elder", "Your diet has been replaced"],
  ["Patrol zones on Hollow Valley are:", "Mapped areas the tracker can count when your dinosaur enters them", "Rooms where growth is paused", "A Discord voice channel"],
  ["If the tracker says you are outside migration, patrol and sanctuary zones, you are:", "Not inside one of those mapped areas right now", "Deleted from Dino Storage", "Signed out of Steam"],
  ["Resetting tracked zone visits on Hollow Valley:", "Restarts this life's migration, patrol and sanctuary counts and keeps an existing Prime status", "Removes an existing Prime status", "Deletes the dinosaur from Dino Storage"],
  ["Zone visit counters on Hollow Valley:", "Start again for that dinosaur's next life", "Are shared with every player", "Are sold in the Marketplace"],
  ["Valley Arcade challenges are:", "Free to play, with no purchases, stakes, trading or cash-out", "A wager that can take Valley Coins from your Wallet", "Sold only to subscribers"],
  ["How does a Hollow Valley membership change Arcade crate odds?", "It does not. Subscriber benefits never change crate odds", "It doubles the rare rewards", "It locks crates until you subscribe"],
  ["A correct Arcade answer can award:", "Arcade XP, a Valley fragment and Valley Coins", "A better crate table than other players", "Another player's dinosaur"],
  ["Free Arcade plays reset:", "At midnight Brisbane time", "When a subscriber joins", "After every sanctuary visit"],
  ["Emberwake, Frostveil and Verdant Warden are:", "Colour presets earned from Arcade crates, not sold", "Paid Marketplace listings", "Server rules you have to accept"],
  ["When Arcade dinosaur delivery is enabled, a dinosaur reward:", "Can be delivered to Dino Storage without changing the dinosaur you are playing", "Replaces your live dinosaur immediately", "Is published with your Steam ID"],
  ["Which Hollow Valley animal has three facial horns and a bony frill?", "Triceratops", "Stegosaurus", "Carnotaurus"],
  ["Which herbivore has plates along its back and spikes on its tail?", "Stegosaurus", "Tenontosaurus", "Deinosuchus"],
  ["Which carnivore has a pair of horns above its eyes and very short arms?", "Carnotaurus", "Ceratosaurus", "Maiasaura"],
  ["Deinosuchus is best described as:", "A giant semi-aquatic crocodile, not a dinosaur", "A flying pterosaur", "A plated herbivore"],
  ["Pteranodon is best described as:", "A flying pterosaur, not a dinosaur", "A herd herbivore", "A crocodile"],
  ["Which herbivore is known for a thick domed skull?", "Pachycephalosaurus", "Dryosaurus", "Herrerasaurus"],
  ["Diabloceratops is:", "A horned herbivore that stands with the herd", "A fish hunter with a sail", "An aquatic crocodile"],
  ["Which species is the feathered forager with long claws?", "Beipiaosaurus", "Tyrannosaurus", "Triceratops"],
  ["Tenontosaurus is known on Hollow Valley as:", "A herd herbivore with a strong kick", "An aquatic ambush hunter", "A toothless flyer"],
  ["In The Isle: Evrima, growth is shown as:", "A percentage from a hatchling toward fully grown", "One level shared by every species on your account", "A crate you buy on the website"],
  ["Eating on The Isle: Evrima helps a dinosaur grow when:", "The food suits that species", "The dinosaur stands still in one spot", "The player opens a paid Arcade crate"],
  ["A juvenile dinosaur on The Isle: Evrima is:", "An early, smaller growth stage", "Always the strongest animal on the server", "A separate species from the adult"]
];

const guess = [
  ["I have three facial horns and a frill, and I eat plants. Who am I?", "Triceratops", "Stegosaurus", "Carnotaurus"],
  ["Plates run down my back, and the spikes are on my tail. Who am I?", "Stegosaurus", "Diabloceratops", "Deinosuchus"],
  ["Two horns sit over my eyes, my arms are tiny, and I hunt. Who am I?", "Carnotaurus", "Triceratops", "Maiasaura"],
  ["I wait at the water, and I am a crocodile rather than a dinosaur. Who am I?", "Deinosuchus", "Pteranodon", "Dryosaurus"],
  ["I fly, and I am a pterosaur rather than a dinosaur. Who am I?", "Pteranodon", "Omniraptor", "Hypsilophodon"],
  ["My skull is a thick dome, and I eat plants. Who am I?", "Pachycephalosaurus", "Ceratosaurus", "Beipiaosaurus"],
  ["A horn sits on my snout, and I am a carnivore. Who am I?", "Ceratosaurus", "Diabloceratops", "Stegosaurus"],
  ["I am a very small bipedal herbivore. Moving early is my best defense. Who am I?", "Hypsilophodon", "Deinosuchus", "Tyrannosaurus"],
  ["I am a fast herd grazer, and I am not a duck-bill. Who am I?", "Dryosaurus", "Maiasaura", "Carnotaurus"],
  ["I am a duck-billed herbivore that travels with a herd. Who am I?", "Maiasaura", "Carnotaurus", "Herrerasaurus"],
  ["I am a beaked herbivore with a strong kick. Who am I?", "Tenontosaurus", "Pteranodon", "Deinosuchus"],
  ["I am a horned herbivore with a long frill, and I am not Triceratops. Who am I?", "Diabloceratops", "Stegosaurus", "Ceratosaurus"],
  ["Two thin crests sit on my snout, and I hunt on land. Who am I?", "Dilophosaurus", "Diabloceratops", "Pteranodon"],
  ["I am a large carnivore with two fingers on each hand. Who am I?", "Tyrannosaurus", "Tenontosaurus", "Pachycephalosaurus"],
  ["I am a mid-sized hunter, built to chase with a group, and I am not Carnotaurus. Who am I?", "Allosaurus", "Stegosaurus", "Beipiaosaurus"],
  ["I am a feathered raptor and a pack hunter. Who am I?", "Omniraptor", "Triceratops", "Gallimimus"],
  ["I am a small carnivore that becomes more threatening in a group, and I am not the raptor. Who am I?", "Troodon", "Omniraptor", "Tenontosaurus"],
  ["I forage, I have feathers and long claws, and I am not a raptor. Who am I?", "Beipiaosaurus", "Omniraptor", "Pteranodon"],
  ["I am a quick omnivore scout, built to cover distance rather than to fight. Who am I?", "Gallimimus", "Deinosuchus", "Tyrannosaurus"],
  ["I am a small land carnivore, nimble, and I am not the raptor. Who am I?", "Herrerasaurus", "Omniraptor", "Pachycephalosaurus"]
];

module.exports = { trivia, guess };
