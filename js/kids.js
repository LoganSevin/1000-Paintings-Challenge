/**
 * Kids Mode — original studio catalogs, games, and a grown-up passcode lock.
 * Show/character names are public titles. Cards are original. Watch links are YouTube search.
 */
(function () {
  "use strict";

  var PASS = "4200";
  var KEY_MODE = "kidsMode";
  var KEY_MORE = "kidsMoreUnlocked";
  var lockWait = null;
  var gameTimer = 0;
  var gameLoop = 0;
  var sheetEl = null;

  function $(id) {
    return document.getElementById(id);
  }

  function yt(q) {
    return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q + " official");
  }

  function show(name, showName, blurb, hue, emoji) {
    return { n: name, s: showName || "", b: blurb, h: hue, e: emoji };
  }

  var BABY = [
    show("Cocomelon", "Nursery songs", "Sing-along nursery rhymes and everyday toddler stories.", 145, "🍉"),
    show("Pinkfong Baby Shark", "Songs", "Catchy animal songs and dance-along nursery hits.", 48, "🦈"),
    show("Little Baby Bum", "Nursery rhymes", "Classic rhymes with simple shapes and friendly faces.", 200, "🚌"),
    show("Super Simple Songs", "Songs", "Slow, clear songs that teach words, colors, and counting.", 210, "🎵"),
    show("Ms. Rachel", "Songs & talk", "Warm talk, signs, and songs for first words.", 330, "💛"),
    show("Blippi", "Explore", "High-energy field trips to parks, trucks, and museums.", 195, "🧢"),
    show("Sesame Street", "Muppets", "Letters, numbers, and kindness with neighborhood friends.", 95, "🐦"),
    show("Elmo", "Sesame Street", "A small red monster who loves to laugh and hug.", 0, "❤️"),
    show("Big Bird", "Sesame Street", "An eight-foot yellow bird who is still learning the world.", 50, "🐦"),
    show("Cookie Monster", "Sesame Street", "A blue monster whose favorite word is cookie.", 210, "🍪"),
    show("Grover", "Sesame Street", "A furry blue monster, waiter, superhero, and friend.", 220, "💙"),
    show("Oscar the Grouch", "Sesame Street", "A green grouch who lives in a trash can.", 120, "🗑️"),
    show("Bert", "Sesame Street", "The tall, serious roommate who loves paperclips and pigeons.", 200, "📎"),
    show("Ernie", "Sesame Street", "Bert's rubber-duckie roommate with a giggle.", 25, "🦆"),
    show("Count von Count", "Sesame Street", "A vampire who cannot resist counting.", 270, "🔢"),
    show("Abby Cadabby", "Sesame Street", "A little fairy who is still practicing her magic.", 300, "🧚"),
    show("Rosita", "Sesame Street", "A bilingual turquoise monster with a guitar.", 160, "🎸"),
    show("Zoe", "Sesame Street", "An orange monster who loves ballet and her pet rock Rocco.", 30, "🩰"),
    show("Telly Monster", "Sesame Street", "A worrywart monster who loves triangles.", 15, "🔺"),
    show("Snuffy", "Sesame Street", "Mr. Snuffleupagus, Big Bird's big brown friend.", 25, "🦣"),
    show("Prairie Dawn", "Sesame Street", "A little girl Muppet who writes school pageants.", 40, "📝"),
    show("Baby Bear", "Sesame Street", "A young bear who goes to school on the Street.", 35, "🧸"),
    show("Julia", "Sesame Street", "A yellow Muppet on the autism spectrum with her own way of playing.", 48, "💛"),
    show("Gonger", "Sesame Street", "Cookie Monster's foodie friend from Furchester Hotel.", 12, "🍳"),
    show("Tango", "Sesame Street", "Elmo's puppy.", 20, "🐕"),
    show("Super Grover", "Sesame Street", "Grover in a cape, crashing for justice.", 220, "🦸"),
    show("Two-Headed Monster", "Sesame Street", "Two heads, one argument, a lot of cooperation.", 10, "👾"),
    show("Honkers", "Sesame Street", "Noses that honk instead of talk.", 330, "📯"),
    show("The Amazing Mumford", "Sesame Street", "A magician whose tricks never quite go as planned.", 260, "🎩"),
    show("Herry Monster", "Sesame Street", "A strong blue monster with a gentle side.", 200, "💪"),
    show("Murray Monster", "Sesame Street", "An orange monster who hosts Word on the Street.", 25, "📰"),
    show("Karli", "Sesame Street", "A green foster Muppet in Elmo's friend group.", 140, "💚"),
    show("Rudy", "Sesame Street", "Abby's stepbrother who is still figuring out fairy life.", 280, "🪄"),
    show("Ovejita", "Sesame Street", "A little sheep who helps Murray with words.", 0, "🐑"),
    show("Slimey", "Sesame Street", "Oscar's pet worm, including a trip to the moon.", 130, "🪱"),
    show("Barkley", "Sesame Street", "A big shaggy dog on the Street.", 30, "🐶"),
    show("Daniel Tiger's Neighborhood", "Feelings", "Gentle stories about sharing, waiting, and big feelings.", 18, "🐯"),
    show("Daniel Tiger", "Daniel Tiger's Neighborhood", "A little tiger who sings about feelings.", 18, "🐯"),
    show("Katerina Kittycat", "Daniel Tiger's Neighborhood", "Daniel's cousin in a pink bow.", 330, "🐱"),
    show("O the Owl", "Daniel Tiger's Neighborhood", "Daniel's neighbor who loves facts.", 40, "🦉"),
    show("Prince Wednesday", "Daniel Tiger's Neighborhood", "A prince kid who still has to take turns.", 260, "👑"),
    show("Miss Elaina", "Daniel Tiger's Neighborhood", "A playful friend in a red coat.", 0, "🧥"),
    show("Bluey", "Family play", "A heeler family that turns chores into games.", 210, "🐶"),
    show("Bingo Heeler", "Bluey", "Bluey's little sister, ready for the next game.", 20, "🐕"),
    show("Bandit Heeler", "Bluey", "Dad, also known as the horse in every backyard game.", 25, "🐴"),
    show("Chilli Heeler", "Bluey", "Mum, who keeps the games and the feelings on track.", 12, "❤️"),
    show("Muffin Heeler", "Bluey", "A cousin with a lot of volume.", 5, "📢"),
    show("Peppa Pig", "Family", "Muddy puddles, family days, and simple adventures.", 330, "🐷"),
    show("George Pig", "Peppa Pig", "Peppa's little brother and his dinosaur.", 200, "🦕"),
    show("Mummy Pig", "Peppa Pig", "Glasses, work calls, and muddy-puddle patience.", 320, "👓"),
    show("Daddy Pig", "Peppa Pig", "The biggest puddle jumper in the family.", 20, "👨"),
    show("Suzy Sheep", "Peppa Pig", "Peppa's best friend.", 0, "🐑"),
    show("Paw Patrol", "Rescue pups", "Pups roll out to help Adventure Bay.", 220, "🐾"),
    show("Chase", "Paw Patrol", "Police pup, spy pup, and team leader energy.", 210, "🚓"),
    show("Marshall", "Paw Patrol", "Fire-and-rescue dalmatian who still trips on the way out.", 5, "🚒"),
    show("Skye", "Paw Patrol", "Cockapoo pilot in the clouds.", 320, "🚁"),
    show("Rubble", "Paw Patrol", "Bulldog on the digger.", 40, "🚜"),
    show("Rocky", "Paw Patrol", "Recycling pup who would rather not get wet.", 140, "♻️"),
    show("Zuma", "Paw Patrol", "Water-rescue pup on the hovercraft.", 20, "🚤"),
    show("Everest", "Paw Patrol", "Snow-rescue pup.", 195, "❄️"),
    show("Tracker", "Paw Patrol", "Jungle-rescue pup with big ears.", 30, "🌴"),
    show("Liberty", "Paw Patrol", "The city pup on a scooter.", 0, "🛴"),
    show("Ryder", "Paw Patrol", "The kid who calls the pups to the Lookout.", 200, "📱"),
    show("Dora the Explorer", "Adventure", "Map, backpack, and Spanish words on the trail.", 35, "🗺️"),
    show("Boots", "Dora the Explorer", "Dora's monkey friend with red boots.", 12, "🐵"),
    show("Swiper", "Dora the Explorer", "A fox who swipes — unless you say Swiper no swiping.", 25, "🦊"),
    show("Backpack", "Dora the Explorer", "Rápido — everything you need is inside.", 10, "🎒"),
    show("Map", "Dora the Explorer", "I'm the Map.", 130, "🗺️"),
    show("Go, Diego, Go!", "Animals", "Rescue animals with Diego and Baby Jaguar.", 130, "🐆"),
    show("Bubble Guppies", "School under the sea", "Preschool lessons with singing fish kids.", 190, "🐠"),
    show("Molly", "Bubble Guppies", "A guppy in a pink shirt who loves to sing the lesson.", 330, "🎤"),
    show("Gil", "Bubble Guppies", "A guppy in orange who jumps in first.", 25, "🟠"),
    show("Deema", "Bubble Guppies", "A guppy who turns every lesson into a show.", 45, "🌟"),
    show("Oona", "Bubble Guppies", "A gentle guppy with a pink ponytail.", 300, "💗"),
    show("Nonny", "Bubble Guppies", "A quiet guppy with glasses and the facts.", 200, "👓"),
    show("Goby", "Bubble Guppies", "A green guppy with a big imagination.", 140, "🟢"),
    show("Mr. Grouper", "Bubble Guppies", "The teacher fish of the classroom.", 30, "🐟"),
    show("Team Umizoomi", "Math heroes", "Milli, Geo, and Bot solve city problems with math.", 12, "🔷"),
    show("Milli", "Team Umizoomi", "Pattern power and a dress of shapes.", 330, "👗"),
    show("Geo", "Team Umizoomi", "Shape power and Super Shapes.", 210, "🔷"),
    show("Bot", "Team Umizoomi", "The robot with the Belly Belly Screen.", 45, "🤖"),
    show("Wonder Pets!", "Rescue", "Linny, Tuck, and Ming-Ming fly the Flyboat.", 160, "🐢"),
    show("Linny", "Wonder Pets!", "A guinea pig who leads the Flyboat.", 40, "🐹"),
    show("Tuck", "Wonder Pets!", "A turtle who says I know we can.", 140, "🐢"),
    show("Ming-Ming", "Wonder Pets!", "A duckling who is not a baby.", 50, "🦆"),
    show("Little Einsteins", "Music trips", "A kid quartet travels the world to famous music.", 265, "🚀"),
    show("Leo", "Little Einsteins", "The conductor with the baton.", 0, "🎼"),
    show("Annie", "Little Einsteins", "The singer of the team.", 320, "🎤"),
    show("June", "Little Einsteins", "The dancer.", 260, "🩰"),
    show("Quincy", "Little Einsteins", "The musician who can play anything.", 30, "🎺"),
    show("Rocket", "Little Einsteins", "The ship that flies to the music.", 210, "🚀"),
    show("Mickey Mouse Clubhouse", "Clubhouse", "Mouseketools, hot dog dance, and problem solving.", 48, "🐭"),
    show("Mickey Mouse Funhouse", "Playhouse", "Funny Place doors open new pretend worlds.", 42, "🏠"),
    show("Doc McStuffins", "Toy clinic", "A kid doctor who heals stuffed patients.", 320, "🩺"),
    show("Lambie", "Doc McStuffins", "A stuffed lamb who gives hugs.", 330, "🐑"),
    show("Stuffy", "Doc McStuffins", "A brave, slightly clumsy dragon.", 140, "🐉"),
    show("Hallie", "Doc McStuffins", "A hippo nurse with the checkup tools.", 280, "🦛"),
    show("Chilly", "Doc McStuffins", "A stuffed snowman who worries a lot.", 195, "⛄"),
    show("Sofia the First", "Storybook", "A village girl learns castle kindness.", 280, "👑"),
    show("Super Why!", "Literacy", "Super readers jump into storybooks to change the ending.", 260, "📖"),
    show("WordWorld", "Letters", "Animals built from the letters in their names.", 140, "🔤"),
    show("Numberblocks", "Counting", "Number friends who add, split, and build bigger numbers.", 8, "🔢"),
    show("Alphablocks", "Phonics", "Letter friends who stick together to make words.", 200, "🅰️"),
    show("Colourblocks", "Colors", "Color friends mix and match hues.", 300, "🎨"),
    show("Hey Duggee", "Squirrel club", "Badges, crafts, and cheerful club days.", 25, "🐻"),
    show("Bing", "Flop & Bing", "Small worries, big feelings, and a stuffed flopsy friend.", 20, "🐰"),
    show("Octonauts", "Sea rescue", "Underwater crew helps ocean creatures.", 205, "🐙"),
    show("Captain Barnacles", "Octonauts", "A polar bear captain of the Octopod.", 200, "🐻‍❄️"),
    show("Kwazii", "Octonauts", "A daredevil kitten cat with pirate stories.", 20, "🐱"),
    show("Peso", "Octonauts", "A penguin medic with a kind bedside manner.", 210, "🐧"),
    show("Dashi", "Octonauts", "A dog who takes the photos and the intel.", 30, "📷"),
    show("Inkling", "Octonauts", "An octopus professor in the library.", 260, "🐙"),
    show("PJ Masks", "Night heroes", "Catboy, Owlette, and Gekko save the day after dark.", 270, "🌙"),
    show("Catboy", "PJ Masks", "Connor by day, super cat at night.", 210, "🐱"),
    show("Owlette", "PJ Masks", "Amaya by day, owl wings at night.", 0, "🦉"),
    show("Gekko", "PJ Masks", "Greg by day, super strength at night.", 140, "🦎"),
    show("Romeo", "PJ Masks", "A kid villain with too many machines.", 25, "🤖"),
    show("Luna Girl", "PJ Masks", "A moon-moth villain.", 270, "🌙"),
    show("Night Ninja", "PJ Masks", "Sticky splat and a lot of posing.", 220, "🥷"),
    show("Blaze and the Monster Machines", "Trucks", "STEM puzzles with a monster-truck hero.", 22, "🚛"),
    show("Gabby's Dollhouse", "Cats", "A dollhouse of kitty friends and crafty rooms.", 330, "🐱"),
    show("Gabby", "Gabby's Dollhouse", "The kid who shrinks into the dollhouse.", 320, "🎀"),
    show("Pandy Paws", "Gabby's Dollhouse", "Gabby's stuffed cat who comes alive inside.", 140, "🐼"),
    show("MerCat", "Gabby's Dollhouse", "A mermaid cat with potions.", 280, "🧜"),
    show("Cakey Cat", "Gabby's Dollhouse", "A cat-cake who feels every feeling big.", 20, "🍰"),
    show("DJ Catnip", "Gabby's Dollhouse", "Music-room cat.", 260, "🎧"),
    show("Blue's Clues & You!", "Thinking games", "Pawprints lead to the day's clue.", 215, "🟦"),
    show("Blue's Clues", "Thinking games", "The original clue-hunting neighborhood.", 220, "🐾"),
    show("The Wiggles", "Songs", "Fruit salads, hot potatoes, and dance-along bands.", 4, "🎸"),
    show("Barney & Friends", "Imagination", "A big purple friend who loves you.", 280, "💜"),
    show("Yo Gabba Gabba!", "Dance", "DJ Lance, monsters, and super-catchy dances.", 310, "🎤"),
    show("Teletubbies", "Meadow", "Tubby custard, noo-noo, and sun-baby days.", 95, "☀️"),
    show("In the Night Garden", "Bedtime", "Igglepiggle, Upsy Daisy, and the Ninky Nonk.", 250, "🌺"),
    show("Pocoyo", "Play", "A curious kid in a bright, simple world.", 200, "🔵"),
    show("Max & Ruby", "Siblings", "A careful big sister and a messy little brother.", 350, "🐰"),
    show("Little Bear", "Forest", "Gentle forest days with Mother Bear.", 90, "🧸"),
    show("Franklin", "Turtle town", "A turtle learning how friends work.", 140, "🐢"),
    show("Oswald", "City", "A shy octopus and his city pals.", 210, "🐙"),
    show("Bear in the Big Blue House", "Home", "Songs, chores, and a big blue host.", 220, "🏠"),
    show("Rolie Polie Olie", "Robot house", "A round robot family in a shiny planet home.", 45, "🤖"),
    show("Stanley", "Animals", "A kid who asks the Great Big Book of Everything.", 30, "📚"),
    show("Handy Manny", "Tools", "A repair shop where tools talk and help.", 25, "🔧"),
    show("Jake and the Never Land Pirates", "Pirates", "Pirate kids vs Captain Hook on Never Land.", 195, "🏴‍☠️"),
    show("Sheriff Callie's Wild West", "Town", "A kitty sheriff keeps Nice and Friendly Corners kind.", 15, "🤠"),
    show("Puppy Dog Pals", "Pups", "Bingo and Rolly sneak out for backyard missions.", 35, "🐕"),
    show("Spidey and His Amazing Friends", "Hero kids", "Spidey, Ghost-Spider, and Miles help the neighborhood.", 0, "🕸️"),
    show("SuperKitties", "Hero cats", "Cat heroes protect Kittydale.", 320, "😺"),
    show("Firebuds", "Rescue vehicles", "Kid cars and their human friends save the day.", 12, "🚒"),
    show("Masha and the Bear", "Forest", "A lively kid and a patient bear.", 18, "🐻"),
    show("Ben & Holly's Little Kingdom", "Fairies", "Elves, fairies, and slightly messy magic.", 150, "🧚"),
    show("Thomas & Friends", "Engines", "Really useful engines on the Island of Sodor.", 8, "🚂"),
    show("Bob the Builder", "Build", "Can we fix it? Yes we can.", 48, "👷"),
    show("Fireman Sam", "Rescue", "Pontypandy's fire crew keeps the town safe.", 5, "🚒"),
    show("Postman Pat", "Mail", "Greendale mail and a black-and-white cat.", 210, "📮"),
    show("Ni Hao, Kai-Lan", "Feelings", "Mandarin words and heart-first problem solving.", 140, "🌸"),
    show("Little Bill", "Family", "Everyday city family moments.", 30, "🖍️"),
    show("LazyTown", "Move", "Sportacus vs Robbie Rotten — get up and play.", 200, "🏃"),
    show("Mecha Builders", "Build", "Sesame friends in giant robots who fix the town.", 95, "🤖"),
    show("Elinor Wonders Why", "Science", "A curious bunny asks why the world works.", 125, "🐇"),
    show("Alma's Way", "Think it through", "A Bronx kid who pauses and thinks.", 280, "🧠"),
    show("Molly of Denali", "Alaska", "A kid helper in a national park town.", 30, "🏔️"),
    show("Rosie's Rules", "Playhouse", "A Mexican-American kid who makes her own games.", 20, "🎀"),
    show("Work It Out Wombats!", "STEM play", "Wombat kids invent solutions in a treehouse city.", 160, "🐨"),
  ];

  var CHILD = [
    show("SpongeBob SquarePants", "Bikini Bottom", "A fry cook sponge and his underwater town.", 50, "🧽"),
    show("The Fairly OddParents", "Fairy godparents", "Timmy's wishes, Cosmo and Wanda's chaos.", 280, "🧚"),
    show("Jimmy Neutron", "Invent", "A kid genius, a robotic dog, Retroville.", 200, "🧠"),
    show("Hey Arnold!", "City kids", "Football head, boarding house, big-city heart.", 30, "🏈"),
    show("Rugrats", "Babies", "Toddlers who turn the living room into a jungle.", 320, "👶"),
    show("Rocket Power", "Sports", "Skate, surf, and snow with Ocean Shores kids.", 195, "🛹"),
    show("Danny Phantom", "Ghosts", "A half-ghost kid protects Amity Park.", 170, "👻"),
    show("Danny Fenton", "Danny Phantom", "The kid half of the half-ghost hero.", 210, "🔬"),
    show("Sam Manson", "Danny Phantom", "Goth style, zero patience for ghost nonsense.", 270, "🖤"),
    show("Tucker Foley", "Danny Phantom", "PDA, sandwiches, and backup plans.", 110, "📡"),
    show("Jazz Fenton", "Danny Phantom", "The older sister who figures it out.", 20, "📚"),
    show("Vlad Plasmius", "Danny Phantom", "A half-ghost fruit billionaire with a grudge.", 280, "🟣"),
    show("Avatar: The Last Airbender", "Elements", "Aang, Katara, Sokka, and Toph master the elements.", 195, "🌬️"),
    show("The Legend of Korra", "Avatar", "A new Avatar in a city of cars and spirits.", 210, "🔥"),
    show("Recess", "Playground", "Third Street School's six-kid crew.", 35, "🏀"),
    show("Kim Possible", "Spy teen", "Call me, beep me — she can do anything.", 12, "📱"),
    show("Phineas and Ferb", "Summer", "104 days of summer vacation inventions.", 150, "🎢"),
    show("Gravity Falls", "Mystery", "Dipper, Mabel, and journals in a weird town.", 25, "🌲"),
    show("Star vs. the Forces of Evil", "Magic wand", "A princess from Mewni crashes Earth school.", 310, "⭐"),
    show("Amphibia", "Frogs", "Anne Boonchuy hops into a frog world.", 140, "🐸"),
    show("The Owl House", "Boiling Isles", "Luz finds a house of magic and found family.", 270, "🦉"),
    show("DuckTales", "Adventure", "Scrooge, Huey, Dewey, Louie, and Webby.", 48, "🦆"),
    show("Big City Greens", "Country in the city", "The Green family turns a city house into a farm.", 100, "🌽"),
    show("The Ghost and Molly McGee", "Ghost pal", "A cheerful kid and a grumpy ghost.", 200, "👻"),
    show("Moon Girl and Devil Dinosaur", "Hero science", "Lunella Lafayette and a T. rex in New York.", 350, "🦖"),
    show("Kiff", "Squirrel", "A joyful squirrel and her best friend Barry.", 45, "🐿️"),
    show("Hamster & Gretel", "Heroes", "Alien powers, suburban crime-fighting.", 20, "🐹"),
    show("Pokémon", "Trainers", "Catch, train, and befriend pocket monsters.", 50, "⚡"),
    show("Yu-Gi-Oh!", "Cards", "Shadow games and a legendary puzzle.", 48, "🃏"),
    show("Beyblade", "Tops", "Let it rip — spinning stadium duels.", 15, "🌀"),
    show("Sonic X", "Speed", "A blue hedgehog and his human friends.", 220, "💨"),
    show("Teenage Mutant Ninja Turtles", "Heroes in a half shell", "Pizza, sewers, and ninjutsu.", 130, "🐢"),
    show("Miraculous Ladybug", "Paris heroes", "Ladybug and Cat Noir save Paris after school.", 350, "🐞"),
    show("Totally Spies!", "Spies", "Three Beverly Hills friends, secret missions.", 280, "💄"),
    show("My Little Pony: Friendship Is Magic", "Ponyville", "Twilight Sparkle learns friendship is magic.", 290, "🦄"),
    show("Adventure Time", "Ooo", "Finn and Jake in a candy-colored land.", 160, "🗡️"),
    show("Steven Universe", "Gems", "A kid and crystal gems protect Beach City.", 300, "💎"),
    show("Teen Titans Go!", "Tower", "Short, silly missions from the T-shaped tower.", 20, "🗼"),
    show("Ben 10", "Omnitrix", "A kid with ten alien heroes on his wrist.", 110, "⌚"),
    show("The Amazing World of Gumball", "Elmore", "A blue cat, a goldfish, and a wild school.", 200, "🐱"),
    show("Craig of the Creek", "Creek kids", "Creek maps, sticks, and kid kingdoms.", 140, "🗺️"),
    show("We Bare Bears", "City bears", "Grizz, Panda, and Ice Bear try to fit in.", 30, "🐻"),
    show("The Powerpuff Girls", "Townsville", "Sugar, spice, and Chemical X.", 320, "💥"),
    show("Dexter's Laboratory", "Lab", "A boy genius vs his sister Dee Dee.", 210, "🧪"),
    show("Foster's Home for Imaginary Friends", "Friends", "A mansion where imaginary friends live.", 260, "🏠"),
    show("Ed, Edd n Eddy", "Cul-de-sac", "Jawbreakers and backyard schemes.", 45, "🍬"),
    show("Codename: Kids Next Door", "KND", "Kids vs adult villainy, 2x4 technology.", 200, "📦"),
    show("Chowder", "Cooking", "A young chef, a giant pot, and Marzipan City.", 15, "🍲"),
    show("Regular Show", "Park", "Mordecai and Rigby after the park closes.", 250, "🐦"),
    show("Looney Tunes", "Slapstick", "Bugs, Daffy, Porky, and a whole lot of anvils.", 48, "🥕"),
    show("Tom and Jerry", "Chase", "Cat, mouse, no words needed.", 10, "🧀"),
    show("Scooby-Doo", "Mysteries", "A van, a dog, and not-quite ghosts.", 40, "🚐"),
    show("The Flintstones", "Bedrock", "A stone-age family with a snout-powered car.", 25, "🦴"),
    show("Animaniacs", "Warners", "Yakko, Wakko, and Dot behind the water tower.", 280, "💧"),
    show("Tiny Toon Adventures", "Acme Looniversity", "Student toons learning the old gags.", 50, "🎓"),
    show("Arthur", "Elwood City", "An aardvark, his friends, and everyday school.", 8, "👓"),
    show("The Magic School Bus", "Field trips", "Ms. Frizzle shrinks the class into science.", 16, "🚌"),
    show("Cyberchase", "Math", "Kids stop Hacker in Cyberspace with math.", 200, "💻"),
    show("Wild Kratts", "Creatures", "Creature power suits and animal facts.", 130, "🦁"),
    show("Odd Squad", "Agents", "Kid agents fix odd math problems.", 210, "🔍"),
    show("Lego Ninjago", "Ninjas", "Spinjitzu, elemental powers, and a team.", 0, "🥷"),
    show("Transformers: Rescue Bots", "Rescue", "Autobots who help a human family.", 48, "🤖"),
    show("Maya and the Three", "Legend", "A warrior princess and a three-day prophecy.", 20, "🗡️"),
    show("Kipo and the Age of Wonderbeasts", "Mute city", "A girl, mega-animals, and a found family.", 150, "🐆"),
    show("She-Ra and the Princesses of Power", "Etheria", "Adora, Glimmer, Bow, and the rebellion.", 320, "⚔️"),
    show("The Loud House", "Siblings", "Lincoln and ten sisters in one loud house.", 220, "📢"),
    show("The Casagrandes", "Family", "Ronnie Anne in a big city apartment family.", 25, "🌮"),
  ];

  var DISNEY_CARTOONS = [
    show("Mickey Mouse", "Mickey & friends", "The studio's original mouse lead.", 0, "🐭"),
    show("Minnie Mouse", "Mickey & friends", "Polka dots, kindness, and big plans.", 330, "🎀"),
    show("Donald Duck", "Mickey & friends", "A sailor shirt and a famous temper.", 210, "🦆"),
    show("Daisy Duck", "Mickey & friends", "Donald's stylish, no-nonsense pal.", 300, "💐"),
    show("Goofy", "Mickey & friends", "A tall, happy klutz in a green hat.", 120, "🎩"),
    show("Pluto", "Mickey & friends", "Mickey's loyal pup.", 35, "🐕"),
    show("Chip", "Rescue Rangers", "A brave chipmunk in a fedora.", 30, "🐿️"),
    show("Dale", "Rescue Rangers", "The Hawaiian-shirt half of the duo.", 18, "🐿️"),
    show("Scrooge McDuck", "DuckTales", "The world's richest duck, still hunting relics.", 48, "💰"),
    show("Launchpad McQuack", "DuckTales", "If it flies, he can crash it — and walk away.", 200, "✈️"),
    show("Darkwing Duck", "St. Canard", "Let's get dangerous.", 260, "🌙"),
    show("Baloo", "TaleSpin", "A cargo-plane bear who loves the easy life.", 35, "🐻"),
    show("Goliath", "Gargoyles", "Stone by day, guardian by night.", 220, "🗿"),
    show("Kim Possible", "Kim Possible", "Cheerleader by day, global hero after school.", 12, "📱"),
    show("Ron Stoppable", "Kim Possible", "Rufus in the pocket, snacks in the other.", 40, "🐹"),
    show("Phineas Flynn", "Phineas and Ferb", "The kid who never wastes a summer day.", 150, "🔺"),
    show("Ferb Fletcher", "Phineas and Ferb", "Quiet builder, wild ideas.", 140, "🔧"),
    show("Perry the Platypus", "Phineas and Ferb", "Agent P vs Dr. Doofenshmirtz.", 170, "🦆"),
    show("Dipper Pines", "Gravity Falls", "Journals, constellations, and mysteries.", 200, "🌲"),
    show("Mabel Pines", "Gravity Falls", "Sweaters, glitter, and unstoppable hope.", 320, "⭐"),
    show("Star Butterfly", "Star vs. the Forces of Evil", "Dimensional scissors and a royal wand.", 310, "⭐"),
    show("Anne Boonchuy", "Amphibia", "A tennis racket in a frog world.", 25, "🐸"),
    show("Luz Noceda", "The Owl House", "A human witch-in-training.", 30, "🦉"),
    show("Elsa", "Frozen", "Ice magic and a sister she would not let go.", 195, "❄️"),
    show("Anna", "Frozen", "Brave, warm, and always running toward Elsa.", 0, "🌸"),
    show("Moana", "Moana", "Wayfinding across the ocean to restore the heart.", 185, "🌊"),
    show("Simba", "The Lion King", "A cub who grows into a king.", 40, "🦁"),
    show("Aladdin", "Aladdin", "A street kid, a lamp, and Agrabah.", 35, "🪔"),
    show("Jasmine", "Aladdin", "A princess who wants the world, not a palace wall.", 280, "💎"),
    show("Ariel", "The Little Mermaid", "A mermaid who collects human things — and songs.", 190, "🧜"),
    show("Belle", "Beauty and the Beast", "Books first, then a castle of talking furniture.", 48, "📚"),
    show("Tiana", "The Princess and the Frog", "A New Orleans cook with a restaurant dream.", 140, "🐸"),
    show("Rapunzel", "Tangled", "Seventy feet of hair and a frying pan.", 50, "🌼"),
    show("Mulan", "Mulan", "A warrior who took her father's place.", 20, "⚔️"),
    show("Stitch", "Lilo & Stitch", "Experiment 626, ohana means family.", 210, "👽"),
    show("Lilo", "Lilo & Stitch", "A little sister who believes in ohana.", 200, "🌺"),
    show("Winnie the Pooh", "Hundred Acre Wood", "A bear of very little brain and a lot of honey.", 45, "🍯"),
    show("Buzz Lightyear", "Toy Story", "To infinity — and beyond.", 200, "🚀"),
    show("Woody", "Toy Story", "A cowboy doll who keeps the room together.", 18, "🤠"),
    show("Lightning McQueen", "Cars", "Ka-chow — Radiator Springs racing.", 5, "🏎️"),
    show("Judy Hopps", "Zootopia", "A bunny cop in a city of predators and prey.", 320, "🐰"),
    show("Mirabel Madrigal", "Encanto", "The only Madrigal without a gift — and the one who sees.", 150, "🦋"),
    show("Miguel", "Coco", "A guitar, family memory, and the Land of the Dead.", 25, "🎸"),
    show("Joy", "Inside Out", "Headquarters' brightest feeling.", 50, "😊"),
    show("Baymax", "Big Hero 6", "A inflatable nurse-bot who is satisfied with his care.", 200, "🤖"),
    show("Jack-Jack", "The Incredibles", "A baby with every superpower at once.", 12, "👶"),
    show("WALL-E", "WALL-E", "A lonely trash bot who finds a plant — and EVE.", 40, "🌱"),
    show("Nemo", "Finding Nemo", "A clownfish who gets lost on the reef.", 25, "🐠"),
    show("Mike Wazowski", "Monsters, Inc.", "One eye, lots of jokes, scare-floor pal.", 110, "👁️"),
    show("Snow White", "Snow White and the Seven Dwarfs", "The 1937 princess whose kindness wakes a kingdom.", 0, "🍎"),
    show("Cinderella", "Cinderella", "Glass slippers, midnight, and a pumpkin coach.", 200, "👠"),
    show("Aurora", "Sleeping Beauty", "A cursed sleep and a spinning wheel.", 280, "🌹"),
    show("Pinocchio", "Pinocchio", "A wooden boy who wants to be real.", 30, "🪵"),
    show("Jiminy Cricket", "Pinocchio", "Conscience in a top hat.", 140, "🦗"),
    show("Geppetto", "Pinocchio", "The woodcarver who wished on a star.", 35, "⭐"),
    show("Dumbo", "Dumbo", "Big ears, a feather, and a circus sky.", 210, "🐘"),
    show("Bambi", "Bambi", "A fawn learning the forest.", 90, "🦌"),
    show("Thumper", "Bambi", "If you can't say something nice…", 20, "🐰"),
    show("Peter Pan", "Peter Pan", "The boy who wouldn't grow up.", 195, "🧚"),
    show("Tinker Bell", "Peter Pan / Fairies", "Pixie dust and a short temper.", 150, "✨"),
    show("Wendy Darling", "Peter Pan", "Stories in the nursery, then Never Land.", 220, "📘"),
    show("Lady", "Lady and the Tramp", "A cocker spaniel, a spaghetti night.", 330, "🍝"),
    show("Tramp", "Lady and the Tramp", "A street dog with a heart.", 25, "🐕"),
    show("Pongo", "101 Dalmatians", "A spotted dad on a London rescue.", 0, "⚪"),
    show("Merlin", "The Sword in the Stone", "A wizard who turns a boy into a king.", 210, "🧙"),
    show("Mowgli", "The Jungle Book", "A man-cub raised by wolves.", 30, "🐺"),
    show("Robin Hood", "Robin Hood", "A fox who steals from the rich.", 130, "🏹"),
    show("Duchess", "The Aristocats", "Paris, jazz, and three kittens.", 260, "🐱"),
    show("Bernard", "The Rescuers", "A timid mouse from the Rescue Aid Society.", 40, "🐭"),
    show("Miss Bianca", "The Rescuers", "The brave Hungarian mouse agent.", 320, "🎀"),
    show("Tod", "The Fox and the Hound", "A fox who was raised with a hound.", 20, "🦊"),
    show("Oliver", "Oliver & Company", "An orange kitten in New York.", 25, "😺"),
    show("Hercules", "Hercules", "A hero in training, zero to hero.", 45, "⚡"),
    show("Tarzan", "Tarzan", "A man of the jungle who finds a family twice.", 140, "🌿"),
    show("Kuzco", "The Emperor's New Groove", "An emperor who becomes a llama.", 48, "🦙"),
    show("Merida", "Brave", "A Scottish archer who will not be betrothed.", 15, "🏹"),
    show("Vanellope von Schweetz", "Wreck-It Ralph", "A glitch who becomes a president of racing.", 310, "🍬"),
    show("Raya", "Raya and the Last Dragon", "A warrior seeking the last dragon.", 190, "🐉"),
    show("Nick Wilde", "Zootopia", "A fox hustler who becomes a cop's partner.", 25, "🦊"),
  ];

  var DISNEY_TV = [
    show("Miley Stewart", "Hannah Montana", "A regular girl with a pop-star double life.", 280, "🎤"),
    show("Lilly Truscott", "Hannah Montana", "Best friend, skate parks, and secret-keeping.", 200, "🛹"),
    show("Alex Russo", "Wizards of Waverly Place", "The sibling most likely to spell trouble.", 270, "✨"),
    show("Justin Russo", "Wizards of Waverly Place", "The rule-following wizard brother.", 220, "📘"),
    show("Max Russo", "Wizards of Waverly Place", "Youngest wizard, biggest chaos.", 40, "🪄"),
    show("Harper Finkle", "Wizards of Waverly Place", "Alex's best friend with homemade fashion.", 330, "👗"),
    show("Zack Martin", "The Suite Life", "The twin who schemes first.", 20, "🏨"),
    show("Cody Martin", "The Suite Life", "The twin who studies first.", 200, "📓"),
    show("London Tipton", "The Suite Life", "Hotel heiress, catchphrases, closet the size of a wing.", 300, "💄"),
    show("Mr. Moseby", "The Suite Life", "The manager holding the Tipton together.", 45, "🛎️"),
    show("Raven Baxter", "That's So Raven / Raven's Home", "Psychic visions and fashion-forward plans.", 280, "👁️"),
    show("Lizzie McGuire", "Lizzie McGuire", "Animated-Lizzie thoughts, real-Lizzie middle school.", 320, "💭"),
    show("Gordo", "Lizzie McGuire", "The best friend with a camera and a comment.", 210, "🎥"),
    show("Jessie Prescott", "Jessie", "A Texas nanny in a New York penthouse.", 12, "🤠"),
    show("Emma Ross", "Jessie / Bunk'd", "Oldest Ross kid, makeup channel dreams.", 330, "💅"),
    show("Luke Ross", "Jessie", "The middle kid who never sits still.", 30, "😜"),
    show("Ravi Ross", "Jessie", "The trivia champ with a lizard named Mrs. Kipling.", 140, "🦎"),
    show("Zuri Ross", "Jessie", "Youngest Ross, biggest personality.", 50, "👑"),
    show("Austin Moon", "Austin & Ally", "A singer who found a songwriting partner.", 200, "🎶"),
    show("Ally Dawson", "Austin & Ally", "Stage-shy writer who becomes a star too.", 320, "🎹"),
    show("Liv Rooney", "Liv and Maddie", "Twin who comes home from a hit TV show.", 210, "🌟"),
    show("Maddie Rooney", "Liv and Maddie", "Twin who lives for basketball.", 25, "🏀"),
    show("Teddy Duncan", "Good Luck Charlie", "Big sister making video diaries for Charlie.", 350, "📹"),
    show("Andi Mack", "Andi Mack", "A teen figuring out family, friends, and identity.", 15, "💜"),
    show("K.C. Cooper", "K.C. Undercover", "A mathlete who is also a teen spy.", 220, "🕵️"),
    show("Troy Bolton", "High School Musical", "Wildcats captain who also wants to sing.", 12, "🏀"),
    show("Gabriella Montez", "High School Musical", "The new kid with the other half of the duet.", 190, "📚"),
    show("Sharpay Evans", "High School Musical", "Drama-club queen in pink.", 330, "🐩"),
    show("Mal", "Descendants", "Maleficent's daughter choosing her own story.", 270, "💜"),
    show("Evie", "Descendants", "The Evil Queen's daughter, sewing and chemistry.", 210, "💙"),
    show("Carlos De Vil", "Descendants", "Cruella's kid who loves gadgets more than coats.", 0, "🖤"),
    show("Jay", "Descendants", "Jafar's son, parkour and a better path.", 30, "🧡"),
    show("Sonny Munroe", "Sonny with a Chance", "A comedian dropped onto a sketch show.", 48, "🎬"),
    show("Chyna Parks", "A.N.T. Farm", "A music prodigy in a high-school gifted program.", 280, "🎹"),
    show("Corey Matthews", "Boy Meets World", "Growing up with Topanga, Shawn, and Mr. Feeny.", 25, "🎒"),
    show("Topanga Lawrence", "Boy Meets World", "The partner who always sees the bigger picture.", 260, "💫"),
    show("Riley Matthews", "Girl Meets World", "Corey and Topanga's daughter, new class of lessons.", 320, "📓"),
    show("Chase Davenport", "Lab Rats", "The bionic sibling with super intelligence.", 200, "🧬"),
    show("Bree Davenport", "Lab Rats", "Super speed and a need to be normal at school.", 330, "💨"),
    show("Kaz", "Mighty Med", "A comic-shop kid in a superhero hospital.", 15, "🏥"),
    show("Paige Olvera", "Bizaardvark", "Half of a viral song-and-sketch duo.", 300, "📱"),
    show("Cyd and Shelby", "Best Friends Whenever", "Two friends who accidentally time-travel.", 190, "⏰"),
    show("Harley Diaz", "Stuck in the Middle", "The inventor in a big family.", 40, "🔧"),
    show("Nini Salazar-Roberts", "HSMTMTS", "A theater kid rewriting the Wildcats story.", 330, "🎤"),
    show("Ricky Bowen", "HSMTMTS", "Guitar-first, script-later.", 210, "🎸"),
  ];

  var NICK_CARTOONS = [
    show("SpongeBob SquarePants", "SpongeBob", "The eternal optimist of Bikini Bottom.", 50, "🧽"),
    show("Patrick Star", "SpongeBob", "Best friend, rock home, big heart.", 320, "⭐"),
    show("Squidward Tentacles", "SpongeBob", "Clarinet, sculpture, and a closed door.", 160, "🐙"),
    show("Mr. Krabs", "SpongeBob", "The Krusty Krab and a love of coins.", 12, "🦀"),
    show("Sandy Cheeks", "SpongeBob", "Texas science under a tree-dome.", 30, "🐿️"),
    show("Timmy Turner", "Fairly OddParents", "Buck teeth, pink hat, two fairies.", 280, "🎩"),
    show("Cosmo", "Fairly OddParents", "The fairy who makes wishes weirder.", 130, "🟢"),
    show("Wanda", "Fairly OddParents", "The fairy who tries to keep wishes safe.", 320, "💗"),
    show("Jimmy Neutron", "Jimmy Neutron", "Think, Jimmy, think.", 48, "🧠"),
    show("Carl Wheezer", "Jimmy Neutron", "Llamas, allergies, loyal friend.", 20, "🦙"),
    show("Cindy Vortex", "Jimmy Neutron", "Rival, brain, and the one who keeps Jimmy honest.", 200, "⭐"),
    show("Arnold", "Hey Arnold!", "The kid in the boarding house with a football head.", 25, "🏈"),
    show("Helga Pataki", "Hey Arnold!", "Tough talk, secret locket.", 12, "🎀"),
    show("Gerald Johanssen", "Hey Arnold!", "Best friend, tall stories, city wisdom.", 35, "🧢"),
    show("Tommy Pickles", "Rugrats", "The baby with the plan.", 200, "🍼"),
    show("Chuckie Finster", "Rugrats", "The scaredy-cat who still goes along.", 20, "👓"),
    show("Angelica Pickles", "Rugrats", "Cynthia doll and the word mine.", 330, "👸"),
    show("Susie Carmichael", "Rugrats", "The neighbor who can out-sing and out-reason Angelica.", 40, "🎤"),
    show("Eliza Thornberry", "The Wild Thornberrys", "The kid who can talk to animals.", 140, "🦜"),
    show("Donnie Thornberry", "The Wild Thornberrys", "Wild child raised by nature.", 30, "🍌"),
    show("Otto Rocket", "Rocket Power", "The daredevil of Ocean Shores.", 200, "🛹"),
    show("Reggie Rocket", "Rocket Power", "Big sister, bigger air.", 350, "🏂"),
    show("Danny Fenton", "Danny Phantom", "Going ghost.", 190, "👻"),
    show("Sam Manson", "Danny Phantom", "Goth style, zero patience for ghosts' nonsense.", 270, "🖤"),
    show("Tucker Foley", "Danny Phantom", "PDA, sandwiches, and backup plans.", 110, "📡"),
    show("Aang", "Avatar: The Last Airbender", "The last airbender, the Avatar.", 195, "🌬️"),
    show("Katara", "Avatar: The Last Airbender", "Waterbender, healer, the heart of the team.", 210, "💧"),
    show("Sokka", "Avatar: The Last Airbender", "Boomerang, sarcasm, and strategy.", 30, "🪃"),
    show("Toph Beifong", "Avatar: The Last Airbender", "The blind earthbender who invented metalbending.", 40, "🪨"),
    show("Zuko", "Avatar: The Last Airbender", "Honor, fire, and a long road home.", 15, "🔥"),
    show("Korra", "The Legend of Korra", "A bender who has to learn the spirit side.", 200, "🌊"),
    show("Lincoln Loud", "The Loud House", "One boy, ten sisters, comic-book plans.", 220, "📰"),
    show("Ronnie Anne Santiago", "The Casagrandes", "Skateboard, city family, new block.", 12, "🛹"),
    show("Leonardo", "TMNT", "Blue mask, katana, the leader.", 210, "🔵"),
    show("Donatello", "TMNT", "Purple mask, the tech turtle.", 270, "🟣"),
    show("Raphael", "TMNT", "Red mask, sai, the hot head.", 0, "🔴"),
    show("Michelangelo", "TMNT", "Orange mask, nunchaku, pizza time.", 30, "🟠"),
    show("Ren and Stimpy", "The Ren & Stimpy Show", "A chihuahua and a cat in rubbery chaos.", 48, "🐶"),
    show("Rocko", "Rocko's Modern Life", "A wallaby in O-Town trying to pay rent.", 150, "🦘"),
    show("Doug Funnie", "Doug", "Journal entries from Bluffington.", 210, "📔"),
    show("Ickis", "Aaahh!!! Real Monsters", "A scare-school monster still learning the jump-scare.", 130, "👾"),
    show("Nigel Thornberry", "The Wild Thornberrys", "Smashing, documentary chaos.", 40, "📹"),
    show("Dora", "Dora the Explorer", "¡Vámonos! The map is out.", 25, "🗺️"),
    show("Backpack", "Dora the Explorer", "Rápido — everything you need is inside.", 10, "🎒"),
    show("Map", "Dora the Explorer", "I'm the Map. I'm the Map.", 130, "🗺️"),
  ];

  var NICK_TV = [
    show("Carly Shay", "iCarly", "A web show from a Seattle loft.", 200, "💻"),
    show("Sam Puckett", "iCarly / Sam & Cat", "Pranks, meat, and loyalty.", 12, "🍔"),
    show("Freddie Benson", "iCarly", "Technical producer, crush next door.", 220, "🎥"),
    show("Spencer Shay", "iCarly", "Artist uncle, sculpture accidents.", 30, "🎨"),
    show("Gibby", "iCarly", "Shirt off, heart on.", 40, "😄"),
    show("Tori Vega", "Victorious", "Hollywood Arts, the new kid with the voice.", 320, "🎤"),
    show("Jade West", "Victorious", "Sharp tongue, sharper talent.", 270, "🖤"),
    show("Cat Valentine", "Victorious / Sam & Cat", "Red hair, redder surprises.", 0, "❤️"),
    show("André Harris", "Victorious", "The songwriter at the piano.", 35, "🎹"),
    show("Beck Oliver", "Victorious", "Actor, calm in the storm.", 190, "🎬"),
    show("Robbie Shapiro", "Victorious", "Rex the puppet always has a comment.", 20, "🧦"),
    show("Drake Parker", "Drake & Josh", "Cool older brother, guitar.", 210, "🎸"),
    show("Josh Nichols", "Drake & Josh", "The stepbrother who tries to do the right thing.", 45, "🥪"),
    show("Megan Parker", "Drake & Josh", "Younger sister, mastermind.", 330, "😈"),
    show("Zoey Brooks", "Zoey 101", "Pacific Coast Academy, new girl on campus.", 200, "🎒"),
    show("Quinn Pensky", "Zoey 101", "Lab coats and unexpected romance.", 140, "🧪"),
    show("Chase Matthews", "Zoey 101", "The roommate with a crush.", 25, "💌"),
    show("Ned Bigby", "Ned's Declassified", "School survival guide, locker 179.", 15, "📒"),
    show("Moze", "Ned's Declassified", "Soccer, honesty, best friend.", 130, "⚽"),
    show("Cookie", "Ned's Declassified", "Schemes, gadgets, cafeteria intel.", 48, "🍪"),
    show("Addie Singer", "Unfabulous", "Songs about middle school in a journal.", 280, "🎸"),
    show("True Jackson", "True Jackson, VP", "A teen fashion VP at a real company.", 50, "👗"),
    show("Kendall Knight", "Big Time Rush", "The lead of a boy band in L.A. Palm Woods.", 210, "🎤"),
    show("Phoebe Thunderman", "The Thundermans", "Superhero teen who actually wants the rules.", 260, "⚡"),
    show("Max Thunderman", "The Thundermans", "Twin brother aiming at villainy (sort of).", 280, "🧪"),
    show("Henry Hart", "Henry Danger", "Kid Danger after school in Swellview.", 48, "🦸"),
    show("Ray Manchester", "Henry Danger", "Captain Man, the grown-up hero.", 12, "🛡️"),
    show("Babe Carano", "Game Shakers", "Half of the game studio in a Brooklyn grocery.", 200, "🎮"),
    show("Double Dare host", "Double Dare", "Slime, physical challenges, the dunk tank.", 140, "🟢"),
    show("Olmec", "Legends of the Hidden Temple", "Stone head, temple gates, pendant runs.", 40, "🗿"),
    show("Keenan & Kel", "Kenan & Kel", "Orange soda and the words 'aw, here it goes'.", 25, "🥤"),
    show("Amanda Bynes sketches", "The Amanda Show", "Moody's Point and a lot of characters.", 320, "📺"),
    show("All That cast", "All That", "Sketch kids, Vital Information, Superdude.", 50, "😂"),
    show("Clarissa Darling", "Clarissa Explains It All", "A door slam, a computer, and a take on everything.", 280, "💻"),
    show("Alex Mack", "The Secret World of Alex Mack", "A chemical spill and a secret to keep.", 210, "💧"),
    show("Pete Wrigley & Little Pete", "The Adventures of Pete & Pete", "Wellsville, endless summer, dad's lawn.", 200, "☀️"),
    show("Angela Anaconda", "Angela Anaconda (Nicktoons era)", "Construction-paper cutout school stories.", 20, "📄"),
    show("iCarly (2021) revival", "iCarly", "The web show comes back as grown-up comedy.", 195, "📱"),
    show("That Girl Lay Lay", "That Girl Lay Lay", "A rapper from an app who becomes a real friend.", 330, "🎤"),
  ];

  var CN_CARTOONS = [
    show("Blossom", "The Powerpuff Girls", "The leader with the bow.", 330, "🎀"),
    show("Bubbles", "The Powerpuff Girls", "The joyful one who talks to animals.", 200, "💙"),
    show("Buttercup", "The Powerpuff Girls", "The tough one who punches first.", 120, "💚"),
    show("Dexter", "Dexter's Laboratory", "Boy genius, secret lab, sister problems.", 210, "🧪"),
    show("Dee Dee", "Dexter's Laboratory", "Oops. What does this button do?", 300, "🩰"),
    show("Johnny Bravo", "Johnny Bravo", "Hair, muscles, and a lot of rejection.", 48, "💪"),
    show("Courage", "Courage the Cowardly Dog", "A pink dog in Nowhere who still saves the farm.", 320, "🐶"),
    show("Ed", "Ed, Edd n Eddy", "The big one who loves gravy and chickens.", 40, "🍗"),
    show("Edd (Double D)", "Ed, Edd n Eddy", "Hats, maps, and the voice of reason.", 200, "🧢"),
    show("Eddy", "Ed, Edd n Eddy", "The scam artist chasing jawbreakers.", 25, "💸"),
    show("Numbuh 1", "Kids Next Door", "Bald, goggles, leader of Sector V.", 210, "🥽"),
    show("Numbuh 2", "Kids Next Door", "2x4 tech, bad puns, great piloting.", 30, "✈️"),
    show("Numbuh 3", "Kids Next Door", "Rainbow monkeys and a sunny uppercut.", 330, "🌈"),
    show("Numbuh 4", "Kids Next Door", "The brawler who hates anything mushy.", 50, "🥊"),
    show("Numbuh 5", "Kids Next Door", "Coolest operative, candy expert.", 140, "🍭"),
    show("Mac", "Foster's Home", "The kid who created Bloo.", 200, "👦"),
    show("Bloo", "Foster's Home", "An imaginary friend who wants to stay.", 210, "🔵"),
    show("Wilt", "Foster's Home", "Tall, kind, slightly broken arm.", 12, "🏀"),
    show("Eduardo", "Foster's Home", "A scaredy-cat monster with a huge heart.", 130, "👹"),
    show("Coco", "Foster's Home", "A palm-tree friend who says coco.", 25, "🌴"),
    show("Finn", "Adventure Time", "A human kid in the Land of Ooo.", 200, "🎒"),
    show("Jake", "Adventure Time", "A stretchy magic dog and best friend.", 45, "🐕"),
    show("Princess Bubblegum", "Adventure Time", "Scientist ruler of the Candy Kingdom.", 320, "👑"),
    show("Marceline", "Adventure Time", "Vampire queen, bass guitar, old songs.", 270, "🎸"),
    show("Mordecai", "Regular Show", "A blue jay who just wants to skip work.", 210, "🐦"),
    show("Rigby", "Regular Show", "A raccoon who makes every plan worse and funnier.", 25, "🦝"),
    show("Benson", "Regular Show", "The park manager who is this close to snapping.", 5, "💢"),
    show("Gumball Watterson", "The Amazing World of Gumball", "A blue cat in Elmore.", 200, "🐱"),
    show("Darwin Watterson", "The Amazing World of Gumball", "A goldfish with legs and a conscience.", 30, "🐟"),
    show("Anais Watterson", "The Amazing World of Gumball", "The baby who is also the smartest.", 320, "🐰"),
    show("Steven Universe", "Steven Universe", "A kid with a gem in his belly button.", 300, "💎"),
    show("Garnet", "Steven Universe", "A fusion who sees possible futures.", 270, "🟥"),
    show("Amethyst", "Steven Universe", "Shape-shifter, snack thief, loyal friend.", 280, "💜"),
    show("Pearl", "Steven Universe", "Precise, devoted, spear fighter.", 200, "🤍"),
    show("Craig Williams", "Craig of the Creek", "Staff, satchel, creek cartographer.", 140, "🗺️"),
    show("Kelsey", "Craig of the Creek", "Role-play knight of the creek.", 15, "⚔️"),
    show("J.P.", "Craig of the Creek", "The pal who falls in the mud first.", 40, "😅"),
    show("Grizz", "We Bare Bears", "The big brother bear who wants friends.", 30, "🐻"),
    show("Panda", "We Bare Bears", "Shy, online, allergic to a lot.", 0, "🐼"),
    show("Ice Bear", "We Bare Bears", "Ice Bear does the chores. Ice Bear is fine.", 195, "🐻‍❄️"),
    show("Ben Tennyson", "Ben 10", "The Omnitrix kid.", 110, "⌚"),
    show("Gwen Tennyson", "Ben 10", "Magic, maps, and calling Ben out.", 280, "✨"),
    show("Chowder", "Chowder", "Apprentice chef, bottomless stomach.", 20, "🍲"),
    show("Flapjack", "The Marvelous Misadventures of Flapjack", "Candied Island dreams.", 48, "🍭"),
    show("Samurai Jack", "Samurai Jack", "A samurai thrown into a future ruled by Aku.", 40, "⚔️"),
    show("Aku", "Samurai Jack", "Shape-shifting master of darkness (and bad puns).", 0, "🖤"),
    show("Robin", "Teen Titans / TTG", "The leader in the cape and R.", 5, "🦸"),
    show("Starfire", "Teen Titans", "Tamaranian princess, the word 'friend' matters.", 30, "🌟"),
    show("Raven", "Teen Titans", "Dark magic, a book, and a deadpan stare.", 270, "🔮"),
    show("Beast Boy", "Teen Titans", "Green, jokes, every animal form.", 120, "🦎"),
    show("Cyborg", "Teen Titans", "Half machine, all snacks and speakers.", 45, "🦾"),
    show("K.O.", "OK K.O.! Let's Be Heroes", "A plaza kid training to be a hero.", 12, "👊"),
    show("Mao Mao", "Mao Mao: Heroes of Pure Heart", "A sheriff cat with a legendary sword.", 210, "🐱"),
    show("Uncle Grandpa", "Uncle Grandpa", "A magical relative in an RV.", 40, "🍕"),
    show("Clarence", "Clarence", "A joyful kid who finds the fun in everything.", 48, "😄"),
  ];

  var CN_TV = [
    show("TOMbot (CN promos)", "Cartoon Network promos", "Toonami's host also showed up in CN bumpers — full catalog lives under More.", 210, "🤖"),
    show("Joe (CN City era)", "Cartoon Network bumpers", "A live-action vibe in the city-of-cartoons era.", 200, "🏙️"),
    show("Niyeli (CN Games)", "Cartoon Network", "Live hosts for game specials and challenges.", 30, "🎮"),
    show("Destroy Build Destroy crews", "Destroy Build Destroy", "Teams build, then blow it up, then rebuild.", 15, "💥"),
    show("Dude, What Would Happen? hosts", "Dude, What Would Happen?", "Live-action stunts and messy science.", 48, "🔬"),
    show("Survive This campers", "Survive This", "A reality survival show in the woods.", 140, "🏕️"),
    show("The Othersiders team", "The Othersiders", "Kids investigating supposedly haunted spots.", 270, "👻"),
    show("Tower Prep students", "Tower Prep", "A live-action mystery school with hidden talents.", 220, "🏫"),
    show("Level Up gamers", "Level Up", "Four friends sucked into a game world (live-action + animation mix).", 200, "🕹️"),
    show("Incredible Crew", "Incredible Crew", "Sketch comedy kids in short live bits.", 320, "😂"),
    show("Out of Control kids", "Out of Control", "Early CN live-action sketch chaos.", 25, "📺"),
    show("Big Game (sports bits)", "Cartoon Network", "Live sports-style bits mixed into the lineup.", 12, "🏆"),
    show("CN Real block faces", "CN Real", "A short-lived live-action block of challenge shows.", 40, "📡"),
    show("Friday Night hosts", "Fridays", "Live intro desks for Friday cartoon blocks.", 280, "🎤"),
    show("Staplerfall announcers", "On-air", "Promo voices and live contest callers from the 2000s.", 30, "📢"),
    show("Hall of Game hosts", "Hall of Game Awards", "CN's sports-kid award show personalities.", 48, "🏅"),
  ];

  var DREAMWORKS_FEATURES = [
    show("Shrek", "Shrek", "An ogre who wants his swamp back — and finds a family.", 120, "🟢"),
    show("Donkey", "Shrek", "A talking donkey who never stops talking.", 40, "🫏"),
    show("Princess Fiona", "Shrek", "A princess with an ogre secret.", 140, "👑"),
    show("Puss in Boots", "Puss in Boots / Shrek", "A cat swordsman with the eyes.", 30, "🐱"),
    show("Po", "Kung Fu Panda", "A noodle-shop panda who becomes the Dragon Warrior.", 25, "🐼"),
    show("Tigress", "Kung Fu Panda", "The Furious Five's fiercest fighter.", 15, "🐯"),
    show("Shifu", "Kung Fu Panda", "A red-panda master of the Jade Palace.", 10, "🥋"),
    show("Hiccup", "How to Train Your Dragon", "A Viking who would rather train dragons than slay them.", 200, "⚔️"),
    show("Toothless", "How to Train Your Dragon", "A Night Fury and the other half of a flying team.", 220, "🐉"),
    show("Astrid", "How to Train Your Dragon", "Berk's ace rider, axe and all.", 0, "🪓"),
    show("Alex", "Madagascar", "A lion who learns he is not just a zoo star.", 45, "🦁"),
    show("Marty", "Madagascar", "A zebra who wants to see the wild.", 0, "🦓"),
    show("Gloria", "Madagascar", "A hippo who keeps the crew together.", 280, "🦛"),
    show("Melman", "Madagascar", "A giraffe with a long list of worries.", 50, "🦒"),
    show("Skipper", "Madagascar / Penguins", "A penguin commando who always has a plan.", 210, "🐧"),
    show("Kowalski", "Penguins of Madagascar", "The brains of the penguin unit.", 200, "🧠"),
    show("Private", "Penguins of Madagascar", "The youngest penguin, still learning the mission.", 190, "🐧"),
    show("Rico", "Penguins of Madagascar", "The demolitions penguin.", 15, "💣"),
    show("Megamind", "Megamind", "A blue supervillain who has to learn how to be a hero.", 210, "🧠"),
    show("Metro Man", "Megamind", "Metro City's shining hero — until he isn't.", 48, "🦸"),
    show("Poppy", "Trolls", "A pink-haired troll who believes in hugs and songs.", 320, "🌸"),
    show("Branch", "Trolls", "A gray troll who slowly learns to sing again.", 220, "🌿"),
    show("Grug", "The Croods", "A cave dad who learns the world is bigger than the cave.", 30, "🦴"),
    show("Eep", "The Croods", "A cave teen who runs toward the light.", 20, "🔥"),
    show("The Boss Baby", "The Boss Baby", "A baby in a suit running Baby Corp.", 200, "👔"),
    show("Spirit", "Spirit: Stallion of the Cimarron", "A wild mustang who will not be broken.", 25, "🐴"),
    show("Lucky Prescott", "Spirit Untamed / Riding Free", "A girl who rides with a mustang named Spirit.", 15, "🤠"),
    show("Moses", "The Prince of Egypt", "A prince of Egypt who leads a people home.", 40, "🌊"),
    show("Joseph", "Joseph: King of Dreams", "Dreams, brothers, and a coat of many colors.", 48, "🧥"),
    show("Gingy", "Shrek", "A gingerbread man who has seen some things.", 12, "🍪"),
    show("Dragon (Shrek)", "Shrek", "A keep-guarding dragon who falls for a donkey.", 350, "🐲"),
    show("Oh", "Home", "A Boov on the run who befriends a girl named Tip.", 160, "👽"),
    show("Tip Tucci", "Home", "A girl searching for her mom after the Boov arrive.", 20, "🚀"),
    show("Roz", "The Wild Robot", "A robot who learns the island and raises a gosling.", 180, "🤖"),
    show("The Bad Guys crew", "The Bad Guys", "A wolf-led heist team trying to go good.", 0, "🐺"),
    show("Ruby Gillman", "Ruby Gillman, Teenage Kraken", "A kraken teen hiding in a seaside town.", 210, "🐙"),
    show("Turbo", "Turbo", "A garden snail who wants to race.", 5, "🐌"),
    show("Jack Frost", "Rise of the Guardians", "Winter, fun, and a guardian who was once unseen.", 195, "❄️"),
    show("North", "Rise of the Guardians", "Santa as a warrior-craftsman of wonder.", 0, "🎁"),
    show("Toothiana", "Rise of the Guardians", "The Tooth Fairy, memory keeper.", 320, "🦷"),
    show("Bunnymund", "Rise of the Guardians", "The Easter Bunny with boomerangs.", 140, "🐰"),
    show("Sandy", "Rise of the Guardians", "The silent Sandman of dreams.", 45, "😴"),
    show("Captain Underpants", "Captain Underpants", "A principal turned underwear hero, plus two kid authors.", 12, "🩲"),
    show("Yi", "Abominable", "A violin, a yeti, and a trip across China.", 200, "🎻"),
    show("Everest the Yeti", "Abominable", "A fluffy friend trying to get home.", 210, "🏔️"),
    show("RJ", "Over the Hedge", "A raccoon who teaches suburban animals to raid.", 25, "🦝"),
    show("Verne", "Over the Hedge", "A turtle who liked the forest the way it was.", 130, "🐢"),
    show("Barry B. Benson", "Bee Movie", "A bee who sues honey-makers.", 48, "🐝"),
    show("Oscar", "Shark Tale", "A little fish in a big reef with a fake story.", 200, "🐟"),
    show("B.O.B.", "Monsters vs. Aliens", "A cheerful blob who cannot be harmed.", 140, "🟢"),
    show("Ginormica", "Monsters vs. Aliens", "Susan, fifty feet tall.", 220, "👩"),
    show("Wallace", "Wallace & Gromit / Chicken Run era", "An inventor with a loyal silent dog — Aardman on the DW shelf.", 40, "🧀"),
    show("Gromit", "Wallace & Gromit", "The dog who actually solves the problem.", 0, "🐕"),
    show("Ginger", "Chicken Run", "A hen who will not stay on the farm.", 15, "🐔"),
    show("Mr. Peabody", "Mr. Peabody & Sherman", "A genius dog and his boy, time-machine optional.", 30, "🕰️"),
    show("Sherman", "Mr. Peabody & Sherman", "The adopted boy who jumps through history.", 200, "🎒"),
  ];

  var DREAMWORKS_TV = [
    show("Jim Lake Jr.", "Trollhunters", "A trollhunter under the canals of Arcadia.", 140, "🛡️"),
    show("Claire Nuñez", "Trollhunters", "Shadow staff, stage lights, and the team.", 270, "🌙"),
    show("Toby Domzalski", "Trollhunters", "Warhammer, war-paint, best friend.", 30, "🔨"),
    show("Aja Tarron", "3Below", "A royal alien hiding in Arcadia as a human teen.", 200, "👽"),
    show("Krel Tarron", "3Below", "The inventor prince of House Tarron.", 210, "🔧"),
    show("Douxie", "Wizards: Tales of Arcadia", "A 900-year-old wizard in a hoodie.", 260, "🎸"),
    show("Keith (Voltron)", "Voltron: Legendary Defender", "Red paladin, then Black, of the legendary defender.", 0, "🦁"),
    show("Pidge", "Voltron: Legendary Defender", "Green paladin, the team's hacker.", 130, "💚"),
    show("Hunk", "Voltron: Legendary Defender", "Yellow paladin, cook and heart.", 45, "💛"),
    show("Lance", "Voltron: Legendary Defender", "Blue paladin, sharpshooter.", 210, "💙"),
    show("Allura", "Voltron: Legendary Defender", "Princess of Altea who becomes a paladin.", 280, "✨"),
    show("Adora", "She-Ra and the Princesses of Power", "A Horde soldier who becomes She-Ra.", 40, "⚔️"),
    show("Glimmer", "She-Ra and the Princesses of Power", "Bright Moon's spark-and-teleport princess.", 320, "💖"),
    show("Bow", "She-Ra and the Princesses of Power", "An archer who would rather build than boast.", 20, "🏹"),
    show("Catra", "She-Ra and the Princesses of Power", "A rival who has to choose who she is.", 15, "🐱"),
    show("Daring Do", "The Adventures of Puss in Boots", "San Lorenzo's cat hero on a new beat.", 30, "👢"),
    show("King Julien", "All Hail King Julien", "A lemur king with a groove.", 48, "👑"),
    show("Dinotrux crews", "Dinotrux", "Dinosaur-truck hybrids building in the Crater.", 25, "🦕"),
    show("Ty Rux", "Dinotrux", "A T-trux builder in the Crater.", 20, "🦖"),
    show("Revvit", "Dinotrux", "A reptool mechanic on Ty's team.", 140, "🔧"),
    show("Waldo", "Where's Waldo? (DreamWorks)", "Stripes in a crowd — the TV take.", 5, "🔴"),
    show("Harvey", "Harvey Girls Forever!", "A kid who turns every block into a cartoon.", 320, "⭐"),
    show("George Beard", "The Epic Tales of Captain Underpants", "One half of the kid comics team.", 40, "📕"),
    show("Harold Hutchins", "The Epic Tales of Captain Underpants", "The other half, with the pencil.", 210, "✏️"),
    show("Darius Bowman", "Jurassic World: Camp Cretaceous", "A camp kid among dinosaurs.", 130, "🦕"),
    show("Brooklynn", "Jurassic World: Camp Cretaceous", "A vlogger who has to survive the island.", 330, "📹"),
    show("Tony Toretto", "Fast & Furious Spy Racers", "Dom's cousin in a spy-racing crew.", 12, "🏎️"),
    show("Layla Gray", "Fast & Furious Spy Racers", "The racer who keeps the crew honest.", 200, "🏁"),
  ];

  var CLASSICS_GOLDEN = [
    show("Snow White", "Snow White and the Seven Dwarfs (1937)", "Preserved: the first American feature-length cel cartoon.", 0, "🍎"),
    show("Doc", "Snow White and the Seven Dwarfs", "The dwarfs' leader with the glasses.", 40, "👓"),
    show("Grumpy", "Snow White and the Seven Dwarfs", "The dwarf who is never impressed.", 15, "😠"),
    show("Dopey", "Snow White and the Seven Dwarfs", "The silent youngest dwarf.", 50, "😊"),
    show("The Evil Queen", "Snow White and the Seven Dwarfs", "Magic mirror, poisoned apple.", 270, "🪞"),
    show("Pinocchio", "Pinocchio (1940)", "Preserved: a wooden boy, Pleasure Island, and the whale.", 30, "🪵"),
    show("Dumbo", "Dumbo (1941)", "Preserved: a circus elephant who flies.", 210, "🐘"),
    show("Bambi", "Bambi (1942)", "Preserved: a forest coming-of-age.", 90, "🦌"),
    show("Fantasia", "Fantasia (1940)", "Preserved: music pictured as animation — sorcerer's hats and all.", 260, "🎩"),
    show("Cinderella", "Cinderella (1950)", "Preserved: the glass-slipper fairy tale on film.", 200, "👠"),
    show("Alice", "Alice in Wonderland (1951)", "Down the rabbit hole, a catalog of nonsense.", 195, "🐇"),
    show("Peter Pan", "Peter Pan (1953)", "Preserved: Never Land on the screen.", 195, "🧚"),
    show("Lady", "Lady and the Tramp (1955)", "Preserved: a spaghetti kiss in an alley.", 330, "🍝"),
    show("Sleeping Beauty", "Sleeping Beauty (1959)", "Preserved: widescreen fairy-tale painting in motion.", 280, "🌹"),
    show("Popeye", "Popeye the Sailor", "Preserved: spinach, pipes, and Fleischer/Famous shorts.", 140, "💪"),
    show("Olive Oyl", "Popeye", "The tall sweetheart of the sailor shorts.", 0, "🫒"),
    show("Betty Boop", "Betty Boop", "Preserved: Fleischer's jazz-age cartoon star.", 330, "💋"),
    show("Felix the Cat", "Felix the Cat", "Preserved: the silent-era cat who kept the bag of tricks.", 0, "🐱"),
    show("Mighty Mouse", "Mighty Mouse", "Preserved: a cape, an opera cue, and Terrytoons.", 5, "🐭"),
    show("Woody Woodpecker", "Woody Woodpecker", "Preserved: the laugh, the Lantz shorts.", 12, "🐦"),
    show("Chilly Willy", "Chilly Willy", "A penguin from the Lantz studio.", 200, "🐧"),
    show("Andy Panda", "Andy Panda", "Preserved: Walter Lantz's earlier studio star.", 140, "🐼"),
    show("Heckle and Jeckle", "Heckle and Jeckle", "Preserved: two magpies, one voice each, Terrytoons.", 30, "🐦"),
    show("Mighty Heroes", "The Mighty Heroes", "Preserved: Terrytoons superhero spoof.", 48, "🦸"),
    show("Superman (Fleischer)", "Superman theatrical shorts", "Preserved: 1940s Fleischer/Famous Superman cartoons.", 210, "🦸"),
    show("Gulliver", "Gulliver's Travels (1939)", "Preserved: Fleischer's feature-length voyage.", 40, "⛵"),
    show("Mr. Magoo", "Mr. Magoo", "Preserved: UPA's near-sighted gentleman.", 25, "👓"),
    show("Gerald McBoing-Boing", "Gerald McBoing-Boing", "Preserved: a boy who speaks in sound effects.", 20, "📢"),
    show("Crusader Rabbit", "Crusader Rabbit", "Preserved: often called the first cartoon series made for TV.", 15, "🐰"),
    show("Colonel Bleep", "Colonel Bleep", "Preserved: early color TV space adventures.", 200, "🚀"),
    show("Clutch Cargo", "Clutch Cargo", "Preserved: Syncro-Vox adventure serials.", 30, "✈️"),
    show("Rocky J. Squirrel", "The Rocky and Bullwinkle Show", "Preserved: a flying squirrel vs spies.", 140, "🐿️"),
    show("Bullwinkle J. Moose", "The Rocky and Bullwinkle Show", "A moose of very little brain and a lot of charm.", 25, "🫎"),
    show("Boris Badenov", "Rocky and Bullwinkle", "Pottsylvanian no-goodnik.", 0, "🕵️"),
    show("Natasha Fatale", "Rocky and Bullwinkle", "Boris's partner in schemes.", 330, "🖤"),
    show("Dudley Do-Right", "Rocky and Bullwinkle", "A Canadian mountie who always arrives.", 200, "🐴"),
    show("George of the Jungle", "George of the Jungle", "Watch out for that tree.", 120, "🌴"),
    show("Underdog", "Underdog", "Preserved: a humble dog, a phone booth, a rhyme.", 5, "🦸"),
    show("Tennessee Tuxedo", "Tennessee Tuxedo and His Tales", "A penguin who asks Mr. Whoopee how things work.", 210, "🐧"),
    show("Yogi Bear", "The Yogi Bear Show", "Preserved: smarter than the average bear, picnic baskets.", 40, "🐻"),
    show("Boo-Boo Bear", "Yogi Bear", "The cub who tries to keep Yogi out of trouble.", 30, "🐻"),
    show("Huckleberry Hound", "The Huckleberry Hound Show", "Preserved: a blue hound, a Southern drawl, Hanna-Barbera TV.", 210, "🐶"),
    show("Quick Draw McGraw", "Quick Draw McGraw", "A horse sheriff and his burro deputy.", 45, "🐴"),
    show("Snagglepuss", "Snagglepuss", "Heavens to Murgatroyd — exit, stage left.", 320, "🐱"),
    show("Magilla Gorilla", "Magilla Gorilla", "A gorilla in a pet-shop window.", 15, "🦍"),
    show("Top Cat", "Top Cat", "Preserved: alley cats, a streetwise leader, jazz bumpers.", 48, "😺"),
    show("Atom Ant", "Atom Ant", "Up and at 'em — a tiny superhero ant.", 0, "🐜"),
    show("Secret Squirrel", "Secret Squirrel", "A trench-coat spy squirrel.", 30, "🕵️"),
    show("Jonny Quest", "Jonny Quest", "Preserved: 1964 adventure, science, and a boy named Jonny.", 200, "🗺️"),
    show("Hadji", "Jonny Quest", "Jonny's friend with a calm mind and a few tricks.", 25, "🧿"),
    show("Race Bannon", "Jonny Quest", "The bodyguard who keeps the Quest family moving.", 15, "💪"),
    show("Space Ghost (classic)", "Space Ghost", "Preserved: the 1966 Hanna-Barbera space hero, before the talk show.", 210, "👻"),
    show("The Herculoids", "The Herculoids", "Preserved: a family and their beasts on a far planet.", 40, "🪨"),
    show("Birdman", "Birdman and the Galaxy Trio", "Preserved: solar-powered hero of the Hanna-Barbera hour.", 48, "🦅"),
    show("Frankenstein Jr.", "Frankenstein Jr. and The Impossibles", "A kid scientist and a giant robot.", 140, "🤖"),
    show("The Impossibles", "Frankenstein Jr. and The Impossibles", "A rock band that is also three superheroes.", 20, "🎸"),
    show("Casper", "Casper the Friendly Ghost", "Preserved: a ghost who would rather make friends.", 180, "👻"),
    show("Wendy the Good Little Witch", "Harveytoons", "Casper's witch friend with a kinder spellbook.", 280, "🧙"),
    show("Richie Rich", "Harvey / Filmation", "The poor little rich boy of Harveytoons.", 48, "💰"),
    show("The Pink Panther", "The Pink Panther Show", "Preserved: a mute panther, a jazz theme, DePatie–Freleng.", 320, "🩷"),
    show("The Inspector", "The Pink Panther Show", "A clueless inspector in the panther shorts.", 30, "🕵️"),
    show("Bugs Bunny", "Looney Tunes / Merrie Melodies", "Preserved: what's up, doc — theatrical shorts first.", 50, "🥕"),
    show("Daffy Duck", "Looney Tunes", "A duck who will not be upstaged.", 48, "🦆"),
    show("Porky Pig", "Looney Tunes", "That's all, folks.", 20, "🐷"),
    show("Tweety", "Looney Tunes", "A yellow bird in a cage with a cat problem.", 50, "🐤"),
    show("Sylvester", "Looney Tunes", "Sufferin' succotash.", 210, "🐱"),
    show("Road Runner", "Looney Tunes", "Beep beep — the desert wins.", 5, "🏃"),
    show("Wile E. Coyote", "Looney Tunes", "Acme orders and gravity.", 25, "🐺"),
    show("Elmer Fudd", "Looney Tunes", "A hunter who never quite bags the rabbit.", 40, "🎩"),
    show("Yosemite Sam", "Looney Tunes", "The shortest, loudest gunslinger.", 12, "🤠"),
    show("Tasmanian Devil", "Looney Tunes", "A spinning appetite.", 30, "🌪️"),
    show("Tom", "Tom and Jerry", "Preserved: MGM theatrical cat-and-mouse.", 210, "🐱"),
    show("Jerry", "Tom and Jerry", "The mouse who usually wins.", 30, "🐭"),
    show("Droopy", "MGM shorts", "Preserved: Tex Avery's unbothered basset.", 220, "🐶"),
    show("Kimba", "Kimba the White Lion", "Preserved: Tezuka's white lion, an early TV anime landmark.", 48, "🦁"),
    show("Astro Boy (Tezuka)", "Astro Boy", "Preserved: a boy robot and the start of TV anime as we know it.", 210, "🤖"),
    show("Speed Racer", "Speed Racer / Mach GoGoGo", "Preserved: the Mach 5 and a family racing team.", 5, "🏎️"),
    show("Gigantor", "Gigantor / Tetsujin 28", "Preserved: a boy and a giant remote robot.", 0, "🤖"),
    show("Beany", "Beany and Cecil", "Preserved: a boy, a sea serpent, Clampett TV.", 200, "🧢"),
    show("Cecil the Seasick Sea Serpent", "Beany and Cecil", "A green serpent with a gentle heart.", 140, "🐉"),
  ];

  var CLASSICS_PEANUTS = [
    show("Charlie Brown", "Peanuts", "Preserved: the round-headed kid who never quite kicks the ball.", 40, "⚽"),
    show("Snoopy", "Peanuts", "A beagle with a typewriter, a Sopwith Camel, and a doghouse.", 0, "🐶"),
    show("Woodstock", "Peanuts", "Snoopy's tiny yellow friend.", 50, "🐦"),
    show("Lucy van Pelt", "Peanuts", "The psychiatrist booth is five cents.", 12, "🏥"),
    show("Linus van Pelt", "Peanuts", "A blanket, a monologue, and the Great Pumpkin.", 210, "🟦"),
    show("Sally Brown", "Peanuts", "Charlie Brown's little sister, sweet and sharp.", 20, "🎀"),
    show("Peppermint Patty", "Peanuts", "A ballplayer who calls Charlie Brown 'Chuck'.", 140, "⚾"),
    show("Marcie", "Peanuts", "The quiet friend who says 'sir'.", 30, "👓"),
    show("Schroeder", "Peanuts", "Beethoven on a toy piano.", 220, "🎹"),
    show("Pig-Pen", "Peanuts", "A walking dust cloud with a kind heart.", 25, "💨"),
    show("Franklin", "Peanuts", "The friend Charlie Brown met at the beach.", 35, "⭐"),
    show("A Charlie Brown Christmas", "Peanuts specials (1965)", "Preserved: a sad tree, real kid voices, jazz on network TV.", 140, "🎄"),
    show("It's the Great Pumpkin, Charlie Brown", "Peanuts specials (1966)", "Preserved: a pumpkin patch vigil.", 25, "🎃"),
    show("A Charlie Brown Thanksgiving", "Peanuts specials (1973)", "Toast, popcorn, and a table in the yard.", 30, "🦃"),
    show("The Charlie Brown and Snoopy Show", "CBS (1980s)", "Preserved: weekly Peanuts on Saturday mornings.", 48, "📺"),
    show("This Is America, Charlie Brown", "Peanuts (1988–89)", "Preserved: the gang walks through American history.", 200, "📜"),
    show("Rudolph", "Rudolph the Red-Nosed Reindeer (1964)", "Preserved: Rankin/Bass stop-motion, a glowing nose.", 5, "🦌"),
    show("Hermey", "Rudolph the Red-Nosed Reindeer", "An elf who would rather be a dentist.", 140, "🦷"),
    show("Yukon Cornelius", "Rudolph the Red-Nosed Reindeer", "Silver and gold — and a bumble.", 20, "⛏️"),
    show("Bumble", "Rudolph the Red-Nosed Reindeer", "The Abominable Snow Monster of the North.", 210, "❄️"),
    show("Frosty", "Frosty the Snowman (1969)", "Preserved: a magic hat and a parade through town.", 195, "⛄"),
    show("Hocus Pocus (Frosty)", "Frosty the Snowman", "The rabbit who keeps the hat moving.", 30, "🐰"),
    show("The Grinch", "How the Grinch Stole Christmas! (1966)", "Preserved: Chuck Jones, a heart two sizes too small.", 130, "💚"),
    show("Cindy Lou Who", "How the Grinch Stole Christmas!", "A Who child who offers a cup of water.", 320, "🎀"),
    show("Max the Dog", "How the Grinch Stole Christmas!", "The Grinch's long-suffering dog.", 25, "🐕"),
    show("Heat Miser", "The Year Without a Santa Claus (1974)", "Preserved: Rankin/Bass — I'm Mr. Heat Blister.", 12, "🔥"),
    show("Snow Miser", "The Year Without a Santa Claus", "I'm Mr. White Christmas, I'm Mr. Snow.", 200, "❄️"),
    show("Mrs. Claus", "The Year Without a Santa Claus", "The one who sends Jingle and Jangle south.", 330, "🎄"),
    show("Kris Kringle", "Santa Claus Is Comin' to Town (1970)", "Preserved: Rankin/Bass origin of Santa.", 0, "🎅"),
    show("Winter Warlock", "Santa Claus Is Comin' to Town", "A wizard melted by a toy.", 220, "🧙"),
    show("The Little Drummer Boy", "Rankin/Bass (1968)", "Preserved: a drum, a lamb, a quiet special.", 40, "🥁"),
    show("Nestor the Long-Eared Christmas Donkey", "Rankin/Bass (1977)", "Preserved: a donkey who finds his way.", 30, "🫏"),
    show("Jack Frost (Rankin/Bass)", "Jack Frost (1979)", "Preserved: a snow being who wants to be human.", 195, "❄️"),
    show("H.R. Pufnstuf", "Sid & Marty Krofft (1969)", "Preserved: a dragon mayor on Living Island.", 140, "🐉"),
    show("Jimmy (Pufnstuf)", "H.R. Pufnstuf", "A boy, a magic flute, and Witchiepoo.", 45, "🪈"),
    show("Witchiepoo", "H.R. Pufnstuf", "The witch who wants that flute.", 280, "🧙"),
    show("Land of the Lost (Marshalls)", "Land of the Lost (1974)", "Preserved: a family, Sleestak, and the Pylons.", 30, "🦕"),
    show("Will Marshall", "Land of the Lost", "The older kid in the lost land.", 20, "🎒"),
    show("Holly Marshall", "Land of the Lost", "The younger Marshall who names the dinosaurs.", 320, "⭐"),
    show("Cha-Ka", "Land of the Lost", "A Pakuni friend in the jungle.", 40, "🧡"),
    show("Howdy Doody", "Howdy Doody", "Preserved: a freckled marionette and the Peanut Gallery.", 25, "🤠"),
    show("Captain Kangaroo", "Captain Kangaroo", "Preserved: a gentle morning host, pockets full of stories.", 48, "🦘"),
    show("Mr. Green Jeans", "Captain Kangaroo", "The farmer pal on the Treasure House set.", 140, "👖"),
    show("Kukla", "Kukla, Fran and Ollie", "Preserved: Burr Tillstrom's puppet, live and unscripted.", 20, "🎭"),
    show("Ollie", "Kukla, Fran and Ollie", "A one-toothed dragon puppet.", 130, "🐉"),
    show("Fran Allison", "Kukla, Fran and Ollie", "The human in the middle of the puppet booth.", 330, "🎤"),
    show("Lamb Chop", "Lamb Chop's Play-Along / Shari Lewis", "Preserved: a sock puppet who still says this is the song that never ends.", 0, "🐑"),
    show("Davey", "Davey and Goliath", "Preserved: clay-boy and his dog, Sunday-morning morals.", 40, "👦"),
    show("Goliath (Davey)", "Davey and Goliath", "The talking dog who keeps Davey honest.", 25, "🐕"),
    show("Gumby", "Gumby", "Preserved: a clay boy, the Pokey horse, Art Clokey.", 130, "🟩"),
    show("Pokey", "Gumby", "Gumby's orange horse pal.", 20, "🐴"),
    show("The Banana Splits", "The Banana Splits Adventure Hour (1968)", "Preserved: Fleegle, Bingo, Drooper, Snorky — live costumed hosts.", 48, "🍌"),
  ];

  var CLASSICS_HOLIDAY = [
    show("A Charlie Brown Christmas", "1965", "A tree that needs love, and Vince Guaraldi on piano.", 140, "🎄"),
    show("It's the Great Pumpkin, Charlie Brown", "1966", "Linus waits in the pumpkin patch.", 25, "🎃"),
    show("Rudolph the Red-Nosed Reindeer", "1964", "Island of Misfit Toys, stop-motion that never left TV.", 5, "🦌"),
    show("Frosty the Snowman", "1969", "A hat, a parade, and a train toward the North Pole.", 195, "⛄"),
    show("How the Grinch Stole Christmas!", "1966", "Chuck Jones paints Whoville in limited-TV color.", 130, "💚"),
    show("The Year Without a Santa Claus", "1974", "Heat Miser, Snow Miser, and Mrs. Claus in charge.", 12, "🎅"),
    show("Santa Claus Is Comin' to Town", "1970", "The Burgermeister, the Winter Warlock, a red suit.", 0, "🎁"),
    show("Mister Magoo's Christmas Carol", "1962", "Preserved: Magoo as Scrooge, one of the first animated Christmas specials.", 25, "👻"),
    show("The Little Drummer Boy", "1968", "A drum for a quiet night.", 40, "🥁"),
    show("Mickey's Christmas Carol", "1983", "Scrooge McDuck as Scrooge, a later but lasting special.", 48, "🦆"),
    show("Prep & Landing", "2009", "Elf commandos making rooftops safe — a modern preservation pick.", 200, "🧝"),
  ];

  var TOONAMI = [
    show("TOM", "Toonami host", "The robot host of the block — later a TOM 5 redesign.", 200, "🤖"),
    show("SARA", "Toonami", "The AI co-host in the ship's systems.", 190, "💠"),
    show("Goku", "Dragon Ball Z / Super", "Saiyan hero, Kamehameha, another tournament.", 30, "🟠"),
    show("Vegeta", "Dragon Ball Z", "Prince of all Saiyans.", 220, "💙"),
    show("Piccolo", "Dragon Ball Z", "Namekian mentor, special beam cannon.", 140, "🟢"),
    show("Naruto Uzumaki", "Naruto", "Believe it — a ninja who wants to be Hokage.", 35, "🍜"),
    show("Sasuke Uchiha", "Naruto", "Rival, Sharingan, a long detour.", 260, "🔥"),
    show("Sakura Haruno", "Naruto", "Teammate who becomes a medical powerhouse.", 330, "🌸"),
    show("Kakashi Hatake", "Naruto", "Copy ninja, one eye, always late.", 220, "📖"),
    show("Monkey D. Luffy", "One Piece", "Stretchy captain of the Straw Hats.", 5, "👒"),
    show("Roronoa Zoro", "One Piece", "Three swords, terrible sense of direction.", 140, "⚔️"),
    show("Nami", "One Piece", "Navigator, weather staff, the crew's map.", 20, "🗺️"),
    show("Ichigo Kurosaki", "Bleach", "Substitute Soul Reaper, huge sword.", 15, "🗡️"),
    show("Rukia Kuchiki", "Bleach", "The shinigami who starts Ichigo's story.", 210, "❄️"),
    show("Spike Spiegel", "Cowboy Bebop", "A bounty hunter with a past and a good chair.", 40, "🚬"),
    show("Faye Valentine", "Cowboy Bebop", "Gambler, shipmate, sharp aim.", 330, "♠️"),
    show("Jet Black", "Cowboy Bebop", "The Bebop's mechanic and remaining grown-up.", 130, "🐕"),
    show("Edward Wong", "Cowboy Bebop", "Kid hacker, weird genius.", 50, "💻"),
    show("Heero Yuy", "Gundam Wing", "The silent Gundam pilot.", 220, "🤖"),
    show("Relena Peacecraft", "Gundam Wing", "Pacifist princess in a war of mobile suits.", 200, "🕊️"),
    show("Inuyasha", "Inuyasha", "Half-demon with a sword that can cut anything.", 210, "⚔️"),
    show("Kagome Higurashi", "Inuyasha", "A modern girl pulled into feudal demons.", 280, "🏹"),
    show("Yusuke Urameshi", "Yu Yu Hakusho", "Dead delinquent turned spirit detective.", 25, "👊"),
    show("Hiei", "Yu Yu Hakusho", "Short, sharp, dragon of the darkness flame.", 0, "🔥"),
    show("Kenshin Himura", "Rurouni Kenshin", "A wandering swordsman who will not kill again.", 12, "⚔️"),
    show("Sailor Moon", "Sailor Moon", "Usagi, the moon, and a team of scouts.", 320, "🌙"),
    show("Tuxedo Mask", "Sailor Moon", "Roses from the shadows.", 0, "🌹"),
    show("Sakura Kinomoto", "Cardcaptors", "A kid sealing escaped Clow Cards.", 330, "🃏"),
    show("Shinji Ikari", "Neon Genesis Evangelion", "A reluctant Eva pilot.", 40, "🤖"),
    show("Asuka Langley", "Evangelion", "Ace pilot with a lot of armor.", 12, "📕"),
    show("Batman (Terry McGinnis)", "Batman Beyond", "A new Batman in Neo-Gotham.", 0, "🦇"),
    show("Bruce Wayne (Beyond)", "Batman Beyond", "The old mentor in the chair.", 30, "🪑"),
    show("Superman (JLU)", "Justice League Unlimited", "The big blue of the animated league.", 210, "🦸"),
    show("Wonder Woman (JLU)", "Justice League", "Amazon of the animated league.", 40, "⚔️"),
    show("Green Lantern (John Stewart)", "Justice League", "Willpower, constructs, the Corps.", 140, "💚"),
    show("Ahsoka Tano (2003 Clone Wars)", "Star Wars: Clone Wars", "The early animated Ahsoka-era wars (Toonami ran Clone Wars).", 48, "🌟"),
    show("Ryuko Matoi", "Kill la Kill", "A scissor blade and a living uniform.", 0, "✂️"),
    show("Saitama", "One-Punch Man", "A hero who ends fights in one hit.", 45, "👊"),
    show("Tanjiro Kamado", "Demon Slayer", "Kindness, water breathing, a demon sister.", 20, "🗡️"),
    show("Deku", "My Hero Academia", "A quirkless kid who inherits One For All.", 140, "💚"),
    show("All Might", "My Hero Academia", "The Symbol of Peace.", 48, "💪"),
    show("Senku Ishigami", "Dr. Stone", "Science will save the stone world.", 160, "🧪"),
    show("Gon Freecss", "Hunter x Hunter", "A kid hunter with a bright, dangerous will.", 100, "🎣"),
    show("Killua Zoldyck", "Hunter x Hunter", "An assassin kid choosing friendship.", 220, "⚡"),
    show("FLCL Haruko", "FLCL", "Vespa, guitar, medical-mechanical chaos.", 330, "🛵"),
    show("Thundercats Lion-O", "ThunderCats", "Sword of Omens, sight beyond sight.", 30, "🦁"),
  ];

  var ADULT_SWIM = [
    show("Rick Sanchez", "Rick and Morty", "A drunk genius with a portal gun.", 140, "🧪"),
    show("Morty Smith", "Rick and Morty", "The anxious grandson dragged across universes.", 45, "😰"),
    show("Summer Smith", "Rick and Morty", "Teen sister, sometimes the competent one.", 320, "📱"),
    show("Master Shake", "Aqua Teen Hunger Force", "A milkshake with a huge mouth and worse plans.", 48, "🥤"),
    show("Frylock", "Aqua Teen Hunger Force", "The responsible box of fries with laser eyes.", 40, "🍟"),
    show("Meatwad", "Aqua Teen Hunger Force", "A ball of meat who just wants to play.", 0, "🥩"),
    show("Space Ghost", "Space Ghost Coast to Coast", "A superhero stuck hosting a talk show.", 210, "👻"),
    show("Zorak", "Space Ghost Coast to Coast", "A mantis bandleader who hates the host.", 120, "🦗"),
    show("Moltar", "Space Ghost Coast to Coast", "Director, lava, occasional guest wrangler.", 15, "🌋"),
    show("Robot Chicken narrator world", "Robot Chicken", "Stop-motion sketches, celebrity toys, dark punchlines.", 30, "🤖"),
    show("The Venture brothers", "The Venture Bros.", "Failed boy-adventurers in a super-science family.", 25, "🧑‍🔬"),
    show("Brock Samson", "The Venture Bros.", "Bodyguard, muscle, surprisingly loyal.", 40, "💪"),
    show("Harvey Birdman", "Harvey Birdman, Attorney at Law", "A bird superhero who became a lawyer for Hanna-Barbera clients.", 48, "⚖️"),
    show("Phil Ken Sebben", "Harvey Birdman", "HAHA yes — the boss with the eyepatch.", 50, "😂"),
    show("Huey Freeman", "The Boondocks", "The radical grandson with a sketchbook.", 20, "✏️"),
    show("Riley Freeman", "The Boondocks", "The little brother who wants to be hard.", 12, "🧢"),
    show("Uncle Ruckus", "The Boondocks", "A satirical supporting storm of opinions.", 35, "😤"),
    show("Early Cuyler", "Squidbillies", "A mud squid in the hills with a short fuse.", 140, "🦑"),
    show("Nathan Explosion", "Metalocalypse", "Death-metal frontman of Dethklok.", 0, "🤘"),
    show("Pickles the Drummer", "Metalocalypse", "The drummer who somehow keeps the band alive.", 120, "🥁"),
    show("Moral Orel", "Moral Orel", "A clay-town kid whose lessons go sideways.", 40, "⛪"),
    show("Tim Heidecker & Eric Wareheim", "Tim and Eric", "Absurdist live-action / cartoon hybrid hosts.", 280, "📺"),
    show("Eric Andre", "The Eric Andre Show", "A desk, a plant, and chaos in a suit.", 15, "🍌"),
    show("Joe Pera", "Joe Pera Talks With You", "Very calm talks about rocks, breakfast, and snow.", 200, "🪨"),
    show("Spear", "Primal", "A caveman surviving a prehistoric nightmare.", 25, "🦴"),
    show("Fang", "Primal", "A dinosaur companion in a brutal world.", 210, "🦖"),
    show("Pim", "Smiling Friends", "The cheerful customer-service creature.", 140, "😊"),
    show("Charlie", "Smiling Friends", "The tired coworker who still shows up.", 40, "😐"),
    show("Superjail! Warden", "Superjail!", "A psychedelic warden of an impossible prison.", 320, "🎩"),
    show("Birdgirl", "Birdgirl", "Harvey Birdman's daughter, new cases.", 48, "🦅"),
    show("ATHF Carl", "Aqua Teen Hunger Force", "The next-door guy in the wifebeater.", 20, "🏠"),
    show("Sealab 2021 crew", "Sealab 2021", "An underwater station of terrible adults.", 195, "🌊"),
    show("Xavier: Renegade Angel", "Xavier: Renegade Angel", "A bizarre shaman wandering and lecturing.", 270, "🧙"),
    show("Perfect Hair Forever heroes", "Perfect Hair Forever", "A quest for legendary hair.", 50, "💇"),
    show("The Eric Andre plant", "The Eric Andre Show", "Sometimes the calmest one on set.", 120, "🪴"),
    show("Off the Air curator vibe", "Off the Air", "A late-night collage block more than one character.", 260, "🌀"),
    show("Mr. Pickles", "Mr. Pickles", "A demonic dog in a suburban family (very adult).", 0, "🐶"),
    show("Samurai Jack (S5)", "Samurai Jack", "The Adult Swim season that finished Jack's war with Aku.", 40, "⚔️"),
    show("Ballmastrz 9009", "Ballmastrz 9009", "Hyper-violent future sports parody.", 12, "🏀"),
    show("Royal Crackers family", "Royal Crackers", "A snack-empire family in collapse.", 30, "🍪"),
  ];

  var COLORS = [
    { name: "red", hex: "#e44545" },
    { name: "blue", hex: "#3b7dff" },
    { name: "yellow", hex: "#ffd34e" },
    { name: "green", hex: "#3ecf6e" },
    { name: "orange", hex: "#ff8a3d" },
    { name: "purple", hex: "#8a5cff" },
    { name: "pink", hex: "#ff74c6" },
    { name: "brown", hex: "#a56a3a" },
  ];

  var LETTERS = [
    ["A", "🍎", "apple"],
    ["B", "🎈", "balloon"],
    ["C", "🐱", "cat"],
    ["D", "🐶", "dog"],
    ["E", "🥚", "egg"],
    ["F", "🐸", "frog"],
    ["G", "🍇", "grapes"],
    ["H", "🏠", "house"],
    ["I", "🍦", "ice cream"],
    ["J", "🧃", "juice"],
    ["K", "🪁", "kite"],
    ["L", "🦁", "lion"],
    ["M", "🌙", "moon"],
    ["N", "🪺", "nest"],
    ["O", "🐙", "octopus"],
    ["P", "🍕", "pizza"],
    ["Q", "👸", "queen"],
    ["R", "🌈", "rainbow"],
    ["S", "⭐", "star"],
    ["T", "🌳", "tree"],
    ["U", "☂️", "umbrella"],
    ["V", "🎻", "violin"],
    ["W", "🍉", "watermelon"],
    ["X", "📦", "box (x marks it)"],
    ["Y", "🟡", "yellow"],
    ["Z", "🦓", "zebra"],
  ];

  var WORDS = ["cat", "dog", "sun", "hat", "red", "big", "run", "jump", "play", "blue", "mom", "dad", "yes", "no", "the", "and", "see", "you"];

  function shuffled(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function cardHTML(item) {
    return (
      '<button type="button" class="kd-card" data-n="' +
      encodeURIComponent(item.n) +
      '" style="--h:' +
      item.h +
      '">' +
      '<div class="kd-avatar" aria-hidden="true"><span>' +
      item.e +
      "</span></div>" +
      '<div class="kd-card-body"><strong>' +
      item.n +
      "</strong><em>" +
      (item.s || "") +
      "</em></div></button>"
    );
  }

  function fillGrid(el, list, q) {
    if (!el) return;
    var needle = (q || "").trim().toLowerCase();
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (needle && (it.n + " " + it.s + " " + it.b).toLowerCase().indexOf(needle) < 0) continue;
      html += cardHTML(it);
    }
    el.innerHTML = html || "<p class='kd-note'>No matches. Try another word.</p>";
    el.querySelectorAll(".kd-card").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = decodeURIComponent(btn.getAttribute("data-n") || "");
        var found = null;
        for (var k = 0; k < list.length; k++) {
          if (list[k].n === name) {
            found = list[k];
            break;
          }
        }
        if (found) openSheet(found);
      });
    });
  }

  function openSheet(item) {
    if (!sheetEl) {
      sheetEl = document.createElement("div");
      sheetEl.className = "kd-sheet";
      sheetEl.hidden = true;
      document.body.appendChild(sheetEl);
    }
    sheetEl.innerHTML =
      '<div class="kd-sheet-card" style="--h:' +
      item.h +
      '">' +
      '<div class="kd-sheet-hero">' +
      item.e +
      "</div>" +
      '<div class="kd-sheet-body">' +
      "<h3>" +
      item.n +
      "</h3>" +
      "<p><strong>" +
      (item.s || "") +
      "</strong></p>" +
      "<p>" +
      item.b +
      "</p>" +
      '<p class="kd-note" style="color:#6b5a88">Studio catalog card — original art, not an official still. Watch opens a YouTube search for official uploads.</p>' +
      '<div class="kd-sheet-actions">' +
      '<a class="kd-watch" href="' +
      yt(item.n + (item.s ? " " + item.s : "")) +
      '" target="_blank" rel="noopener noreferrer">Watch search</a>' +
      '<button type="button" class="kd-close" id="kd-sheet-close">Close</button>' +
      "</div></div></div>";
    sheetEl.hidden = false;
    $("kd-sheet-close").addEventListener("click", function () {
      sheetEl.hidden = true;
    });
    sheetEl.onclick = function (e) {
      if (e.target === sheetEl) sheetEl.hidden = true;
    };
  }

  function bindSearch(input, grid, list) {
    if (!input) return;
    var run = function () {
      fillGrid(grid, list, input.value);
    };
    if (!input.dataset.bound) {
      input.dataset.bound = "1";
      input.addEventListener("input", run);
    }
    run();
  }

  function bindSides(wrapId, gridId, sides) {
    var wrap = $(wrapId);
    var grid = $(gridId);
    if (!wrap || !grid) return;
    var keys = Object.keys(sides);
    var mode = keys[0];
    var start = wrap.querySelector("button.active");
    if (start && sides[start.getAttribute("data-side")]) mode = start.getAttribute("data-side");
    function paint() {
      wrap.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b.getAttribute("data-side") === mode);
      });
      var qel = document.querySelector("#" + wrapId.replace("-split", "-q"));
      fillGrid(grid, sides[mode] || [], qel && qel.value);
    }
    wrap.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        var side = b.getAttribute("data-side");
        if (!sides[side]) return;
        mode = side;
        paint();
      });
    });
    var q = document.querySelector("#" + wrapId.replace("-split", "-q"));
    if (q) q.addEventListener("input", paint);
    paint();
    return paint;
  }

  function bindSplit(wrapId, gridId, cartoons, tv) {
    return bindSides(wrapId, gridId, { cartoons: cartoons, tv: tv });
  }

  /* ——— games ——— */
  function stopGames() {
    if (gameTimer) {
      clearInterval(gameTimer);
      gameTimer = 0;
    }
    if (gameLoop) {
      cancelAnimationFrame(gameLoop);
      gameLoop = 0;
    }
  }

  function stage() {
    return $("kd-game-stage");
  }

  function setStage(html) {
    var el = stage();
    if (!el) return;
    stopGames();
    el.hidden = false;
    el.innerHTML = html;
  }

  function memoryGame() {
    var pairs = shuffled(["🐶", "🐱", "🐭", "🦊", "🐸", "🐵", "🐼", "🐷"]).slice(0, 6);
    var deck = shuffled(pairs.concat(pairs));
    var first = null;
    var lock = false;
    var matches = 0;
    setStage(
      '<div class="kd-stage-bar"><span>Memory match</span><span id="kd-mem-score">0 / 6</span><button type="button" id="kd-again">New game</button></div>' +
        '<div class="kd-board kd-mem" id="kd-mem"></div>'
    );
    var board = $("kd-mem");
    deck.forEach(function (face, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kd-tile";
      btn.dataset.face = face;
      btn.dataset.i = String(idx);
      btn.textContent = "?";
      btn.addEventListener("click", function () {
        if (lock || btn.classList.contains("is-match") || btn.classList.contains("is-up")) return;
        btn.classList.add("is-up");
        btn.textContent = face;
        if (!first) {
          first = btn;
          return;
        }
        if (first.dataset.face === face && first !== btn) {
          first.classList.add("is-match");
          btn.classList.add("is-match");
          first = null;
          matches += 1;
          $("kd-mem-score").textContent = matches + " / 6";
        } else {
          lock = true;
          var a = first;
          first = null;
          setTimeout(function () {
            a.classList.remove("is-up");
            btn.classList.remove("is-up");
            a.textContent = "?";
            btn.textContent = "?";
            lock = false;
          }, 700);
        }
      });
      board.appendChild(btn);
    });
    $("kd-again").addEventListener("click", memoryGame);
  }

  function countGame() {
    var n = 3 + Math.floor(Math.random() * 7);
    var faces = ["🎈", "⭐", "🍎", "🐟", "🌸"];
    var face = faces[Math.floor(Math.random() * faces.length)];
    var icons = "";
    for (var i = 0; i < n; i++) icons += "<span>" + face + "</span>";
    var choices = shuffled([n, n + 1, Math.max(1, n - 1), n + 2]).slice(0, 4);
    setStage(
      '<div class="kd-stage-bar"><span>How many?</span><button type="button" id="kd-again">New</button></div>' +
        '<div class="kd-count-row">' +
        icons +
        "</div>" +
        '<div class="kd-learn-choices" id="kd-count-choices"></div>'
    );
    var box = $("kd-count-choices");
    choices.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = String(c);
      b.addEventListener("click", function () {
        box.querySelectorAll("button").forEach(function (x) {
          x.disabled = true;
        });
        b.classList.add(c === n ? "is-ok" : "is-no");
        if (c === n) speak("Yes! " + n);
        else speak("It was " + n);
      });
      box.appendChild(b);
    });
    $("kd-again").addEventListener("click", countGame);
  }

  function colorGame() {
    var target = COLORS[Math.floor(Math.random() * COLORS.length)];
    var mix = shuffled(COLORS);
    setStage(
      '<div class="kd-stage-bar"><span>Tap every ' +
        target.name +
        ' one</span><button type="button" id="kd-again">New</button></div>' +
        '<div class="kd-board kd-colors" id="kd-colors"></div>'
    );
    var box = $("kd-colors");
    var left = 0;
    mix.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "kd-color";
      b.style.background = c.hex;
      b.setAttribute("aria-label", c.name);
      if (c.name === target.name) left += 1;
      b.addEventListener("click", function () {
        if (c.name === target.name) {
          b.style.opacity = "0.25";
          b.disabled = true;
          left -= 1;
          if (left <= 0) speak("You found them all");
        } else {
          b.style.outline = "4px solid #fff";
        }
      });
      box.appendChild(b);
    });
    $("kd-again").addEventListener("click", colorGame);
  }

  function shapeGame() {
    var shapes = [
      { n: "circle", d: "●" },
      { n: "square", d: "■" },
      { n: "triangle", d: "▲" },
      { n: "star", d: "★" },
      { n: "heart", d: "♥" },
      { n: "diamond", d: "◆" },
    ];
    var target = shapes[Math.floor(Math.random() * shapes.length)];
    setStage(
      '<div class="kd-stage-bar"><span>Find the ' +
        target.n +
        '</span><button type="button" id="kd-again">New</button></div>' +
        '<div class="kd-board kd-shapes" id="kd-shapes"></div>'
    );
    var box = $("kd-shapes");
    shuffled(shapes.concat(shapes)).forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "kd-tile";
      b.textContent = s.d;
      b.addEventListener("click", function () {
        b.classList.add(s.n === target.n ? "is-match" : "is-no");
        if (s.n === target.n) speak("That's a " + target.n);
      });
      box.appendChild(b);
    });
    $("kd-again").addEventListener("click", shapeGame);
  }

  function letterGame() {
    var item = LETTERS[Math.floor(Math.random() * 26)];
    var opts = shuffled(
      [item[0]].concat(
        shuffled(LETTERS.map(function (x) {
          return x[0];
        }))
          .filter(function (x) {
            return x !== item[0];
          })
          .slice(0, 3)
      )
    );
    setStage(
      '<div class="kd-stage-bar"><span>What letter starts this word?</span><button type="button" id="kd-again">New</button></div>' +
        '<p class="kd-learn-q">' +
        item[1] +
        "  " +
        item[2] +
        "</p>" +
        '<div class="kd-learn-choices" id="kd-let"></div>'
    );
    speak(item[2] + " starts with " + item[0]);
    var box = $("kd-let");
    opts.forEach(function (L) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = L;
      b.addEventListener("click", function () {
        box.querySelectorAll("button").forEach(function (x) {
          x.disabled = true;
        });
        b.classList.add(L === item[0] ? "is-ok" : "is-no");
      });
      box.appendChild(b);
    });
    $("kd-again").addEventListener("click", letterGame);
  }

  function starCatch() {
    setStage(
      '<div class="kd-stage-bar"><span>Catch the stars · <span id="kd-star-score">0</span></span><span id="kd-star-time">30</span><button type="button" id="kd-again">Restart</button></div>' +
        '<div class="kd-canvas-wrap"><canvas id="kd-stars" width="720" height="320"></canvas></div>'
    );
    var canvas = $("kd-stars");
    var ctx = canvas.getContext("2d");
    var score = 0;
    var left = 30;
    var stars = [];
    function spawn() {
      stars.push({
        x: 20 + Math.random() * (canvas.width - 40),
        y: -20,
        v: 1.4 + Math.random() * 2.2,
        r: 10 + Math.random() * 8,
      });
    }
    for (var i = 0; i < 6; i++) spawn();
    canvas.addEventListener("pointerdown", function (e) {
      var rect = canvas.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      var y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      for (var i = stars.length - 1; i >= 0; i--) {
        var s = stars[i];
        var dx = s.x - x;
        var dy = s.y - y;
        if (dx * dx + dy * dy < (s.r + 12) * (s.r + 12)) {
          stars.splice(i, 1);
          score += 1;
          $("kd-star-score").textContent = String(score);
          spawn();
        }
      }
    });
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach(function (s) {
        s.y += s.v;
        if (s.y > canvas.height + 20) {
          s.y = -20;
          s.x = 20 + Math.random() * (canvas.width - 40);
        }
        ctx.fillStyle = "#ffe27a";
        ctx.beginPath();
        for (var p = 0; p < 5; p++) {
          var a = (p * Math.PI * 2) / 5 - Math.PI / 2;
          var b = a + Math.PI / 5;
          ctx.lineTo(s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r);
          ctx.lineTo(s.x + Math.cos(b) * (s.r * 0.4), s.y + Math.sin(b) * (s.r * 0.4));
        }
        ctx.closePath();
        ctx.fill();
      });
      gameLoop = requestAnimationFrame(tick);
    }
    gameLoop = requestAnimationFrame(tick);
    gameTimer = setInterval(function () {
      left -= 1;
      var t = $("kd-star-time");
      if (t) t.textContent = String(left);
      if (left <= 0) {
        stopGames();
        speak("Score " + score);
      }
    }, 1000);
    $("kd-again").addEventListener("click", starCatch);
  }

  function speak(text) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ——— learning: Grade 1–12 ——— */
  var LEARN_KEY_G = "kidsLearnGrade";
  var LEARN_KEY_S = "kidsLearnStars";
  var learnGrade = 1;
  var learnSubject = "math";
  var GRADE_META = [
    { n: 1, label: "Grade 1", blurb: "Count, add and subtract to 10, letters, CVC words, rhymes." },
    { n: 2, label: "Grade 2", blurb: "Facts to 20, tens, skip-count, sight words, complete a sentence." },
    { n: 3, label: "Grade 3", blurb: "Times tables, simple division, halves, nouns and verbs." },
    { n: 4, label: "Grade 4", blurb: "Multi-digit math, fractions, homophones, main idea." },
    { n: 5, label: "Grade 5", blurb: "Decimals, order of operations, volume, figurative language." },
    { n: 6, label: "Grade 6", blurb: "Ratios, percents, integers, topic sentences, academic vocab." },
    { n: 7, label: "Grade 7", blurb: "Integer operations, proportions, expressions, literary devices." },
    { n: 8, label: "Grade 8", blurb: "Linear equations, slope, exponents, claims and evidence." },
    { n: 9, label: "Grade 9", blurb: "Algebra I, area, Pythagorean triples, thesis support." },
    { n: 10, label: "Grade 10", blurb: "Systems, geometry, mean, SAT-style vocab and rhetoric." },
    { n: 11, label: "Grade 11", blurb: "Functions, trig values, quadratics, college-ready diction." },
    { n: 12, label: "Grade 12", blurb: "Functions, probability, sequences, advanced vocab and rhetoric." },
  ];

  function randInt(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function loadGrade() {
    try {
      learnGrade = Math.min(12, Math.max(1, parseInt(localStorage.getItem(LEARN_KEY_G), 10) || 1));
    } catch (eG) {
      learnGrade = 1;
    }
  }
  function saveGrade() {
    try {
      localStorage.setItem(LEARN_KEY_G, String(learnGrade));
    } catch (eS) {}
  }
  function starsMap() {
    try {
      return JSON.parse(localStorage.getItem(LEARN_KEY_S) || "{}");
    } catch (eM) {
      return {};
    }
  }
  function gradeStars(g, sub) {
    var m = starsMap();
    var row = m[String(g)] || {};
    return parseInt(row[sub] || 0, 10) || 0;
  }
  function addStar() {
    var m = starsMap();
    var k = String(learnGrade);
    if (!m[k]) m[k] = { math: 0, english: 0 };
    m[k][learnSubject] = (m[k][learnSubject] || 0) + 1;
    try {
      localStorage.setItem(LEARN_KEY_S, JSON.stringify(m));
    } catch (eA) {}
  }

  function qMc(prompt, ans, extra) {
    var pool = (extra || []).filter(function (x) {
      return String(x) !== String(ans);
    });
    while (pool.length < 3) pool.push(String(ans) + "?");
    return { prompt: prompt, ans: String(ans), opts: shuffled([String(ans)].concat(shuffled(pool).slice(0, 3))), kind: "mc" };
  }
  function qType(prompt, ans, hint) {
    return { prompt: prompt, ans: String(ans), kind: "type", hint: hint || "" };
  }

  function mathForGrade(g) {
    var a, b, c, n;
    if (g === 1) {
      n = Math.random();
      if (n < 0.34) {
        a = randInt(1, 9);
        b = randInt(0, 10 - a);
        return qMc(a + " + " + b + " = ?", a + b, [a + b + 1, Math.max(0, a + b - 1), a + b + 2, b]);
      }
      if (n < 0.67) {
        a = randInt(2, 10);
        b = randInt(0, a);
        return qMc(a + " − " + b + " = ?", a - b, [a - b + 1, a + b, Math.max(0, a - b - 1), a]);
      }
      a = randInt(1, 10);
      b = randInt(1, 10);
      while (b === a) b = randInt(1, 10);
      return qMc("Which is bigger, " + a + " or " + b + "?", Math.max(a, b), [Math.min(a, b), a + b, 0]);
    }
    if (g === 2) {
      n = Math.random();
      if (n < 0.3) {
        a = randInt(6, 20);
        b = randInt(1, Math.min(9, a));
        return qMc(a + " − " + b + " = ?", a - b, [a + b, a - b + 2, a - b - 1, b]);
      }
      if (n < 0.6) {
        a = randInt(4, 12);
        b = randInt(3, 9);
        return qMc(a + " + " + b + " = ?", a + b, [a + b + 10, a + b - 1, a * 2, b + 10]);
      }
      if (n < 0.8) {
        a = pick([2, 5, 10]);
        b = a * randInt(2, 6);
        return qMc("Skip count by " + a + ". What comes after " + b + "?", b + a, [b + 1, b - a, b * 2]);
      }
      a = randInt(2, 9) * 10;
      return qMc("How many tens in " + a + "?", a / 10, [a, a / 10 + 1, 10]);
    }
    if (g === 3) {
      n = Math.random();
      if (n < 0.4) {
        a = randInt(2, 10);
        b = randInt(2, 10);
        return qMc(a + " × " + b + " = ?", a * b, [a + b, a * b + a, a * (b - 1), a * b + 1]);
      }
      if (n < 0.7) {
        b = randInt(2, 9);
        a = b * randInt(2, 9);
        return qMc(a + " ÷ " + b + " = ?", a / b, [b, a - b, a / b + 1, a]);
      }
      a = pick([8, 10, 12, 16, 20]);
      return qMc("What is 1/2 of " + a + "?", a / 2, [a, a / 2 + 1, a * 2, 2]);
    }
    if (g === 4) {
      n = Math.random();
      if (n < 0.35) {
        a = randInt(120, 480);
        b = randInt(25, 199);
        return qType(a + " + " + b + " = ?", a + b, "Add the numbers.");
      }
      if (n < 0.65) {
        a = randInt(12, 48);
        b = randInt(3, 9);
        return qType(a + " × " + b + " = ?", a * b);
      }
      if (n < 0.85) {
        return qMc("1/2 + 1/4 = ?", "3/4", ["1/4", "1/2", "2/4", "1"]);
      }
      a = randInt(50, 200);
      b = randInt(11, 49);
      return qType(a + " − " + b + " = ?", a - b);
    }
    if (g === 5) {
      n = Math.random();
      if (n < 0.3) {
        a = randInt(1, 8);
        b = randInt(1, 8);
        return qType(a + " + " + (b / 10).toFixed(1) + " = ?", (a + b / 10).toFixed(1));
      }
      if (n < 0.55) {
        a = randInt(2, 6);
        b = randInt(2, 8);
        c = randInt(1, 5);
        return qType(a + " × (" + b + " + " + c + ") = ?", a * (b + c), "Do parentheses first.");
      }
      if (n < 0.8) {
        a = randInt(2, 6);
        b = randInt(2, 6);
        c = randInt(2, 5);
        return qType("Volume of a " + a + " × " + b + " × " + c + " box?", a * b * c);
      }
      a = (randInt(5, 20) / 10).toFixed(1);
      b = randInt(2, 5);
      return qType(a + " × " + b + " = ?", (parseFloat(a) * b).toFixed(1));
    }
    if (g === 6) {
      n = Math.random();
      if (n < 0.3) {
        a = pick([10, 20, 25, 50]);
        b = pick([40, 60, 80, 100, 120]);
        return qType(a + "% of " + b + " = ?", (a / 100) * b);
      }
      if (n < 0.55) {
        a = randInt(2, 6);
        b = randInt(3, 9);
        c = a * randInt(2, 4);
        return qType("Ratio " + a + ":" + b + ". If the first is " + c + ", the second is?", (c / a) * b);
      }
      if (n < 0.8) {
        a = randInt(-9, -1);
        b = randInt(2, 12);
        return qType(a + " + " + b + " = ?", a + b);
      }
      return qMc("3/4 as a decimal?", "0.75", ["0.34", "0.25", "1.75", "0.7"]);
    }
    if (g === 7) {
      n = Math.random();
      if (n < 0.3) {
        a = randInt(-8, -2);
        b = randInt(-6, -2);
        return qType(a + " × " + b + " = ?", a * b, "Negative times negative is positive.");
      }
      if (n < 0.6) {
        a = randInt(2, 9);
        b = a * randInt(3, 12);
        return qType("Solve " + a + "x = " + b + ". x = ?", b / a);
      }
      if (n < 0.8) {
        a = pick([2, 3, 4]);
        b = 5 * randInt(2, 8);
        return qType("What is " + a + "/5 of " + b + "?", (a * b) / 5);
      }
      a = randInt(4, 15);
      b = randInt(6, 18);
      return qType("If 3/" + a + " = 6/x, x = ?", (6 * a) / 3);
    }
    if (g === 8) {
      n = Math.random();
      if (n < 0.3) {
        a = randInt(2, 6);
        b = randInt(1, 9);
        c = randInt(2, 8);
        return qType("y = " + a + "x + " + b + ". If x = " + c + ", y = ?", a * c + b);
      }
      if (n < 0.55) {
        return qType("Slope from (1, 3) to (4, 9)?", 2, "rise / run");
      }
      if (n < 0.8) {
        a = randInt(2, 6);
        b = randInt(3, 5);
        return qType(a + "^" + b + " = ?", Math.pow(a, b));
      }
      a = randInt(2, 8);
      b = randInt(4, 20);
      c = a * randInt(3, 9) + b;
      return qType("Solve " + a + "x + " + b + " = " + c + ". x = ?", (c - b) / a);
    }
    if (g === 9) {
      n = Math.random();
      if (n < 0.35) {
        a = randInt(2, 9);
        b = randInt(2, 15);
        c = a * randInt(2, 12) + b;
        return qType("Solve " + a + "x + " + b + " = " + c + ". x = ?", (c - b) / a);
      }
      if (n < 0.65) {
        a = randInt(4, 14);
        b = randInt(5, 16);
        return qType("Area of a triangle, base " + a + ", height " + b + "?", (a * b) / 2);
      }
      return qType("A right triangle has legs 3 and 4. Hypotenuse?", 5);
    }
    if (g === 10) {
      n = Math.random();
      if (n < 0.3) return qType("Legs 5 and 12. Hypotenuse?", 13);
      if (n < 0.55) {
        a = randInt(1, 8);
        return qType("2x + y = 10. If x = " + a + ", y = ?", 10 - 2 * a);
      }
      if (n < 0.8) {
        a = randInt(2, 9);
        b = randInt(2, 9);
        c = 3 * randInt(4, 10) - a - b;
        if (c < 1) c = a;
        return qType("Mean of " + a + ", " + b + ", " + c + "?", (a + b + c) / 3);
      }
      return qType("3² + 4² = ?", 25);
    }
    if (g === 11) {
      n = Math.random();
      if (n < 0.25) return qMc("sin(30°) = ?", "1/2", ["1", "0", "√3/2", "√2/2"]);
      if (n < 0.5) return qMc("cos(0°) = ?", "1", ["0", "1/2", "-1", "√2/2"]);
      if (n < 0.75) {
        a = pick([4, 5, 6, 7, 8, 9, 11, 12]);
        return qType("x² = " + a * a + ". Positive x = ?", a);
      }
      a = randInt(2, 8);
      b = randInt(1, 12);
      c = randInt(2, 9);
      return qType("f(x) = " + a + "x + " + b + ". f(" + c + ") = ?", a * c + b);
    }
    n = Math.random();
    if (n < 0.25) return qMc("P(heads) on a fair coin?", "1/2", ["1", "0", "2", "1/6"]);
    if (n < 0.5) {
      a = randInt(3, 9);
      return qType(a + "! / " + (a - 1) + "! = ?", a);
    }
    if (n < 0.75) {
      a = randInt(2, 7);
      return qType("f(x) = x². f(" + a + ") = ?", a * a);
    }
    a = randInt(4, 9);
    return qType("If f'(x) = 2x, f'(" + a + ") = ?", 2 * a, "Derivative of x² is 2x.");
  }

  function engForGrade(g) {
    var item, w, r, n;
    var rhymes = [
      ["cat", "hat"],
      ["dog", "frog"],
      ["sun", "run"],
      ["blue", "you"],
      ["star", "car"],
      ["light", "night"],
      ["bake", "cake"],
    ];
    var nouns = ["fox", "school", "river", "city", "team"];
    var verbs = ["jumps", "writes", "runs", "builds", "sings"];
    var syn = [
      ["happy", "glad", "angry", "tiny", "loud"],
      ["big", "large", "soft", "late", "thin"],
      ["smart", "clever", "sticky", "empty", "round"],
      ["scarce", "rare", "noisy", "sweet", "flat"],
      ["begin", "start", "finish", "carry", "paint"],
    ];
    var ant = [
      ["hot", "cold", "warm", "sun", "fire"],
      ["up", "down", "high", "sky", "over"],
      ["always", "never", "often", "soon", "maybe"],
    ];
    var homo = [
      ["their", "there", "A place, not a possession"],
      ["too", "two", "Also, not the number"],
      ["hear", "here", "With your ears"],
      ["write", "right", "With a pencil"],
    ];
    var fig = [
      ["The wind whispered.", "personification", "simile", "hyperbole", "alliteration"],
      ["Busy as a bee.", "simile", "metaphor", "irony", "pun"],
      ["The classroom was a zoo.", "metaphor", "simile", "onomatopoeia", "alliteration"],
      ["Peter Piper picked.", "alliteration", "metaphor", "irony", "pun"],
    ];
    var vocab = [
      ["benevolent", "kind", "angry", "hidden", "tiny"],
      ["ambiguous", "unclear", "musical", "frozen", "legal"],
      ["pragmatic", "practical", "magical", "silent", "ancient"],
      ["candid", "honest", "secret", "bitter", "round"],
      ["resilient", "tough / recovers", "fragile", "empty", "late"],
      ["ephemeral", "short-lived", "eternal", "heavy", "legal"],
      ["ubiquitous", "everywhere", "rare", "ancient", "silent"],
      ["laconic", "few words", "wordy", "colorful", "hungry"],
    ];
    if (g === 1) {
      n = Math.random();
      if (n < 0.4) {
        item = pick(LETTERS);
        return qMc("Which letter starts “" + item[2] + "” " + item[1] + "?", item[0], shuffled(LETTERS.map(function (x) { return x[0]; })).filter(function (x) { return x !== item[0]; }).slice(0, 3));
      }
      if (n < 0.75) {
        w = pick(WORDS);
        return qMc("Tap the word: " + w.toUpperCase(), w, shuffled(WORDS).filter(function (x) { return x !== w; }).slice(0, 3));
      }
      r = pick(rhymes);
      return qMc("Which word rhymes with “" + r[0] + "”?", r[1], ["tree", "milk", "book", "desk"]);
    }
    if (g === 2) {
      n = Math.random();
      if (n < 0.4) {
        w = pick(["because", "there", "friend", "said", "where", "could", "would"]);
        return qMc("Sight word: " + w.toUpperCase(), w, shuffled(["because", "there", "friend", "said", "where", "house", "green", "apple"]).filter(function (x) { return x !== w; }).slice(0, 3));
      }
      if (n < 0.7) return qMc("A sentence needs which ending?", ".", [",", "and", "the"]);
      return qMc("Which is a complete sentence?", "The dog ran.", ["Ran fast.", "The big.", "On the"]);
    }
    if (g === 3) {
      n = Math.random();
      if (n < 0.5) {
        w = pick(nouns);
        return qMc("Which word is a noun?", w, shuffled(verbs.concat(["very", "and"])).slice(0, 3));
      }
      w = pick(verbs);
      return qMc("Which word is a verb?", w, shuffled(nouns.concat(["blue", "the"])).slice(0, 3));
    }
    if (g === 4) {
      n = Math.random();
      if (n < 0.5) {
        r = pick(homo);
        return qMc(r[2] + " — which spelling?", r[0], [r[1], "thar", "too"]);
      }
      return qMc("Main idea is…", "what the text is mostly about", ["the last word", "a rhyming pair", "the author's age"]);
    }
    if (g === 5) {
      r = pick(fig);
      return qMc("“" + r[0] + "” is an example of…", r[1], [r[2], r[3], r[4]]);
    }
    if (g === 6) {
      n = Math.random();
      if (n < 0.5) {
        r = pick(syn);
        return qMc("Synonym of “" + r[0] + "”?", r[1], [r[2], r[3], r[4]]);
      }
      return qMc("A topic sentence should…", "state the paragraph's point", ["list random facts", "be a fragment", "rhyme"]);
    }
    if (g === 7) {
      n = Math.random();
      if (n < 0.5) {
        r = pick(ant);
        return qMc("Antonym of “" + r[0] + "”?", r[1], [r[2], r[3], r[4]]);
      }
      r = pick(fig);
      return qMc("Device in “" + r[0] + "”?", r[1], [r[2], r[3], r[4]]);
    }
    if (g === 8) {
      return qMc("A claim is strongest when it has…", "relevant evidence", ["more adjectives", "a longer title", "rhymes"]);
    }
    if (g === 9) {
      n = Math.random();
      if (n < 0.5) {
        r = pick(vocab);
        return qMc("“" + r[0] + "” most nearly means", r[1], [r[2], r[3], r[4]]);
      }
      return qMc("A thesis should…", "take a clear arguable position", ["ask a yes/no question", "list characters", "be a quote only"]);
    }
    if (g === 10) {
      n = Math.random();
      if (n < 0.5) {
        r = pick(vocab);
        return qMc("Best meaning of “" + r[0] + "”?", r[1], [r[2], r[3], r[4]]);
      }
      return qMc("Ethos in rhetoric is appeal to…", "credibility", ["emotion", "logic only", "rhyme"]);
    }
    if (g === 11) {
      n = Math.random();
      if (n < 0.5) {
        r = pick(vocab);
        return qMc("“" + r[0] + "” means", r[1], [r[2], r[3], r[4]]);
      }
      return qMc("Pathos appeals to…", "emotion", ["credentials", "statistics only", "setting"]);
    }
    n = Math.random();
    if (n < 0.5) {
      r = pick(vocab);
      return qMc("College vocab: “" + r[0] + "”", r[1], [r[2], r[3], r[4]]);
    }
    return qMc("Logos is appeal to…", "reason / evidence", ["the author's fame", "the audience's fear", "a catchy hook only"]);
  }

  function answersMatch(got, want) {
    var a = String(got || "").trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
    var b = String(want || "").trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
    if (a === b) return true;
    var na = parseFloat(a);
    var nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb) && Math.abs(na - nb) < 0.021) return true;
    function frac(s) {
      var m = String(s).match(/^(-?\d+)\/(-?\d+)$/);
      if (!m) return null;
      var d = parseFloat(m[2]);
      return d ? parseFloat(m[1]) / d : null;
    }
    var fa = frac(a);
    var fb = frac(b);
    if (fa != null && !isNaN(nb) && Math.abs(fa - nb) < 0.021) return true;
    if (fb != null && !isNaN(na) && Math.abs(na - fb) < 0.021) return true;
    if (fa != null && fb != null && Math.abs(fa - fb) < 0.021) return true;
    return false;
  }

  function renderLearnQ() {
    var box = $("kd-learn-stage");
    if (!box) return;
    var q = learnSubject === "english" ? engForGrade(learnGrade) : mathForGrade(learnGrade);
    var stars = gradeStars(learnGrade, learnSubject);
    var bar =
      '<div class="kd-stage-bar"><span>Grade ' +
      learnGrade +
      " · " +
      (learnSubject === "english" ? "English" : "Math") +
      " · ★ " +
      stars +
      '</span><button type="button" id="kd-learn-next">Next</button></div>';
    var body = '<p class="kd-learn-q">' + q.prompt + "</p>";
    if (q.hint) body += '<p class="kd-note">' + q.hint + "</p>";
    if (q.kind === "type") {
      body +=
        '<div class="kd-type-row"><input id="kd-learn-in" type="text" inputmode="decimal" autocomplete="off" placeholder="Type the answer" /><button type="button" id="kd-learn-check">Check</button></div>' +
        '<p id="kd-learn-fb" class="kd-learn-fb"></p>';
    } else {
      body += '<div class="kd-learn-choices" id="kd-learn-ch"></div>';
    }
    box.innerHTML = bar + body;
    $("kd-learn-next").addEventListener("click", renderLearnQ);
    function win() {
      addStar();
      speak("Yes");
    }
    function lose() {
      speak("It was " + q.ans);
    }
    if (q.kind === "type") {
      var check = function () {
        var fb = $("kd-learn-fb");
        var inp = $("kd-learn-in");
        var ok = answersMatch(inp && inp.value, q.ans);
        if (fb) {
          fb.textContent = ok ? "★ Correct" : "Answer: " + q.ans;
          fb.className = "kd-learn-fb " + (ok ? "is-ok" : "is-no");
        }
        if (ok) win();
        else lose();
        var btn = $("kd-learn-check");
        if (btn) btn.disabled = true;
        if (inp) inp.disabled = true;
      };
      $("kd-learn-check").addEventListener("click", check);
      $("kd-learn-in").addEventListener("keydown", function (e) {
        if (e.key === "Enter") check();
      });
    } else {
      var ch = $("kd-learn-ch");
      (q.opts || []).forEach(function (n) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = String(n);
        b.addEventListener("click", function () {
          ch.querySelectorAll("button").forEach(function (x) {
            x.disabled = true;
          });
          var ok = answersMatch(n, q.ans);
          b.classList.add(ok ? "is-ok" : "is-no");
          if (ok) win();
          else lose();
        });
        ch.appendChild(b);
      });
    }
  }

  function abcWall() {
    var box = $("kd-learn-stage");
    if (!box) return;
    if (learnGrade <= 2) {
      box.innerHTML =
        '<div class="kd-stage-bar"><span>Grade ' +
        learnGrade +
        " · tap a letter</span></div>" +
        '<div class="kd-board kd-letters" id="kd-abc-wall"></div>';
      var wall = $("kd-abc-wall");
      LETTERS.forEach(function (item) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "kd-tile";
        b.textContent = item[0];
        b.addEventListener("click", function () {
          speak(item[0] + " as in " + item[2]);
        });
        wall.appendChild(b);
      });
      return;
    }
    var banks = {
      3: [["noun", "a person, place, or thing"], ["verb", "an action word"], ["adjective", "a describing word"]],
      4: [["their", "belongs to them"], ["there", "a place"], ["they're", "they are"]],
      5: [["simile", "compares using like or as"], ["metaphor", "says one thing is another"], ["volume", "length times width times height"]],
      6: [["ratio", "a comparison of two quantities"], ["percent", "parts per hundred"], ["integer", "a whole number, positive or negative"]],
      7: [["protagonist", "the main character"], ["theme", "the message of a story"], ["proportion", "two equal ratios"]],
      8: [["slope", "rise over run"], ["claim", "a statement you can argue"], ["exponent", "how many times to multiply a base"]],
      9: [["thesis", "the main arguable point"], ["hypotenuse", "the long side of a right triangle"], ["variable", "a letter that stands for a number"]],
      10: [["rhetoric", "the art of persuasion"], ["mean", "the average"], ["connotation", "the feeling a word carries"]],
      11: [["pathos", "appeal to emotion"], ["quadratic", "a degree-2 polynomial"], ["synthesis", "combining sources into a new point"]],
      12: [["logos", "appeal to reason"], ["derivative", "instantaneous rate of change"], ["ubiquitous", "present everywhere"]],
    };
    var list = banks[learnGrade] || banks[12];
    box.innerHTML =
      '<div class="kd-stage-bar"><span>Grade ' +
      learnGrade +
      " · tap a term</span></div>" +
      '<div class="kd-learn-choices" id="kd-abc-wall"></div>';
    var hold = $("kd-abc-wall");
    list.forEach(function (pair) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = pair[0];
      b.addEventListener("click", function () {
        speak(pair[0] + ". " + pair[1]);
      });
      hold.appendChild(b);
    });
  }

  function moreUnlocked() {
    try {
      return sessionStorage.getItem(KEY_MORE) === "1";
    } catch (e) {
      return false;
    }
  }

  function setMoreUnlocked() {
    try {
      sessionStorage.setItem(KEY_MORE, "1");
    } catch (e) {}
    document.querySelectorAll(".kd-locked-extra").forEach(function (el) {
      el.hidden = false;
    });
    var more = $("kids-more-tab");
    if (more) more.textContent = "More";
  }

  function askPasscode(title) {
    return new Promise(function (resolve) {
      var overlay = $("kids-lock");
      var label = $("kids-lock-title");
      var err = $("kids-lock-err");
      var dots = overlay ? overlay.querySelectorAll(".kids-lock-dots i") : [];
      if (!overlay) {
        var pin = window.prompt(title || "Passcode");
        resolve(pin === PASS);
        return;
      }
      if (lockWait) lockWait(false);
      lockWait = resolve;
      if (label) label.textContent = title || "Grown-ups only";
      if (err) err.textContent = "";
      overlay.hidden = false;
      var buf = "";
      function paint() {
        for (var i = 0; i < dots.length; i++) dots[i].classList.toggle("on", i < buf.length);
      }
      paint();
      overlay.dataset.ready = "1";
      function finish(ok) {
        overlay.hidden = true;
        var fn = lockWait;
        lockWait = null;
        if (fn) fn(ok);
      }
      overlay.onclick = function (e) {
        if (e.target === overlay) finish(false);
      };
      var cancel = $("kids-lock-cancel");
      if (cancel) {
        cancel.onclick = function () {
          finish(false);
        };
      }
      overlay.querySelectorAll(".kids-lock-pad button[data-k]").forEach(function (btn) {
        btn.onclick = function () {
          var k = btn.getAttribute("data-k");
          if (k === "c") buf = "";
          else if (buf.length < 4) buf += k;
          paint();
          if (buf.length === 4) {
            if (buf === PASS) {
              if (err) err.textContent = "";
              finish(true);
            } else {
              if (err) err.textContent = "Wrong code";
              buf = "";
              paint();
            }
          }
        };
      });
    });
  }

  window.KidsLock = {
    ask: askPasscode,
    moreUnlocked: moreUnlocked,
    unlockMore: setMoreUnlocked,
    pass: PASS,
  };

  function kidId(name) {
    return String(name || "").replace(/[^A-Za-z0-9]+/g, "") || "Character";
  }

  function catalogAll(includeLocked) {
    var groups = [
      ["Baby", "baby", BABY],
      ["Child", "child", CHILD],
      ["Disney cartoons", "disney", DISNEY_CARTOONS],
      ["Disney TV", "disney", DISNEY_TV],
      ["Nickelodeon cartoons", "nick", NICK_CARTOONS],
      ["Nickelodeon TV", "nick", NICK_TV],
      ["Cartoon Network cartoons", "cn", CN_CARTOONS],
      ["Cartoon Network TV", "cn", CN_TV],
      ["DreamWorks features", "dreamworks", DREAMWORKS_FEATURES],
      ["DreamWorks TV", "dreamworks", DREAMWORKS_TV],
      ["Classics · Golden Age", "classics", CLASSICS_GOLDEN],
      ["Classics · Charlie Brown era", "classics", CLASSICS_PEANUTS],
      ["Classics · holiday specials", "classics", CLASSICS_HOLIDAY],
    ];
    if (includeLocked) {
      groups.push(["Toonami", "toonami", TOONAMI], ["Adult Swim", "adultswim", ADULT_SWIM]);
    }
    var out = [];
    var seen = {};
    groups.forEach(function (g) {
      (g[2] || []).forEach(function (it) {
        var id = kidId(it.n);
        if (seen[id]) return;
        seen[id] = true;
        out.push({
          id: id,
          name: it.n,
          show: it.s,
          blurb: it.b,
          hue: it.h,
          emoji: it.e,
          net: g[1],
          shelf: g[0],
        });
      });
    });
    return out;
  }

  window.KidsCatalog = {
    all: function () {
      return catalogAll(moreUnlocked());
    },
    allUnlocked: function () {
      return catalogAll(true);
    },
    id: kidId,
  };

  function renderBaby() {
    bindSearch($("kd-baby-q"), $("kd-baby-grid"), BABY);
  }
  function renderChild() {
    fillGrid($("kd-child-grid"), CHILD, ($("kd-child-q") && $("kd-child-q").value) || "");
    if ($("kd-child-q") && !$("kd-child-q").dataset.bound) {
      $("kd-child-q").dataset.bound = "1";
      $("kd-child-q").addEventListener("input", function () {
        fillGrid($("kd-child-grid"), CHILD, $("kd-child-q").value);
      });
    }
    if ($("kd-game-picks") && !$("kd-game-picks").dataset.bound) {
      $("kd-game-picks").dataset.bound = "1";
      $("kd-game-picks").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-game]");
        if (!btn) return;
        $("kd-game-picks").querySelectorAll(".kd-game-pick").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        var g = btn.getAttribute("data-game");
        if (g === "memory") memoryGame();
        else if (g === "count") countGame();
        else if (g === "color") colorGame();
        else if (g === "shape") shapeGame();
        else if (g === "letter") letterGame();
        else if (g === "stars") starCatch();
      });
    }
  }
  var disneyPaint, nickPaint, cnPaint, dreamPaint, classicsPaint;
  function renderDisney() {
    if (!disneyPaint) disneyPaint = bindSplit("kd-disney-split", "kd-disney-grid", DISNEY_CARTOONS, DISNEY_TV);
    else disneyPaint();
  }
  function renderNick() {
    if (!nickPaint) nickPaint = bindSplit("kd-nick-split", "kd-nick-grid", NICK_CARTOONS, NICK_TV);
    else nickPaint();
  }
  function renderCn() {
    if (!cnPaint) cnPaint = bindSplit("kd-cn-split", "kd-cn-grid", CN_CARTOONS, CN_TV);
    else cnPaint();
  }
  function renderDream() {
    if (!dreamPaint) {
      dreamPaint = bindSides("kd-dream-split", "kd-dream-grid", {
        features: DREAMWORKS_FEATURES,
        tv: DREAMWORKS_TV,
      });
    } else dreamPaint();
  }
  function renderClassics() {
    if (!classicsPaint) {
      classicsPaint = bindSides("kd-classics-split", "kd-classics-grid", {
        golden: CLASSICS_GOLDEN,
        peanuts: CLASSICS_PEANUTS,
        holiday: CLASSICS_HOLIDAY,
      });
    } else classicsPaint();
  }
  function renderToonami() {
    bindSearch($("kd-toonami-q"), $("kd-toonami-grid"), TOONAMI);
  }
  function renderAdult() {
    bindSearch($("kd-adult-q"), $("kd-adult-grid"), ADULT_SWIM);
  }
  function paintGrades() {
    var hold = $("kd-grades");
    if (!hold) return;
    loadGrade();
    hold.innerHTML = "";
    GRADE_META.forEach(function (g) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "kd-grade" + (g.n === learnGrade ? " active" : "");
      b.textContent = String(g.n);
      b.title = g.label + " — " + g.blurb;
      b.addEventListener("click", function () {
        learnGrade = g.n;
        saveGrade();
        paintGrades();
        var blurb = $("kd-grade-blurb");
        if (blurb) blurb.textContent = g.label + " — " + g.blurb;
        if (learnSubject === "abc") abcWall();
        else renderLearnQ();
      });
      hold.appendChild(b);
    });
    var blurb = $("kd-grade-blurb");
    var meta = GRADE_META[learnGrade - 1];
    if (blurb && meta) blurb.textContent = meta.label + " — " + meta.blurb;
  }

  function renderLearn() {
    loadGrade();
    paintGrades();
    if ($("kd-learn-split") && !$("kd-learn-split").dataset.bound) {
      $("kd-learn-split").dataset.bound = "1";
      $("kd-learn-split").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-learn]");
        if (!btn) return;
        $("kd-learn-split").querySelectorAll("button").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        var m = btn.getAttribute("data-learn");
        learnSubject = m === "english" ? "english" : m === "abc" ? "abc" : "math";
        if (learnSubject === "abc") abcWall();
        else renderLearnQ();
      });
    }
    if (learnSubject === "abc") abcWall();
    else renderLearnQ();
  }
  function renderMore() {
    var gates = $("kd-more-gates");
    if (!gates || gates.dataset.bound) return;
    gates.dataset.bound = "1";
    gates.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-tab]");
      if (!btn) return;
      var tab = btn.getAttribute("data-tab");
      if (window.GalleryTabs && window.GalleryTabs.showTab) window.GalleryTabs.showTab(tab);
    });
  }

  window.addEventListener("tab-changed", function (e) {
    var t = e.detail && e.detail.tab;
    if (!t || t.indexOf("kids-") !== 0) {
      stopGames();
      return;
    }
    if (t !== "kids-child") stopGames();
    if (t === "kids-baby") renderBaby();
    else if (t === "kids-child") renderChild();
    else if (t === "kids-learn") renderLearn();
    else if (t === "kids-disney") renderDisney();
    else if (t === "kids-nick") renderNick();
    else if (t === "kids-cn") renderCn();
    else if (t === "kids-dreamworks") renderDream();
    else if (t === "kids-classics") renderClassics();
    else if (t === "kids-more") renderMore();
    else if (t === "kids-toonami") renderToonami();
    else if (t === "kids-adultswim") renderAdult();
  });

  window.addEventListener("kids-hide", stopGames);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var overlay = $("kids-lock");
      if (overlay && !overlay.hidden && lockWait) {
        overlay.hidden = true;
        var fn = lockWait;
        lockWait = null;
        fn(false);
      }
      if (sheetEl) sheetEl.hidden = true;
    }
  });
})();
