#!/usr/bin/env python3
"""Build commercial celebrities catalog (public figures + visual vibe for placement)."""
from __future__ import annotations

import json
import re
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "commercial-celebrities.json"


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:64] or "celeb"


def C(
    name: str,
    category: str,
    vibe: str,
    icons: list[str],
    era: str = "",
    known_for: str = "",
    showcases: list[str] | None = None,
):
    return {
        "id": slug(name),
        "name": name,
        "category": category,
        "era": era or "contemporary",
        "vibe": vibe,
        "icons": icons[:8],
        "known_for": known_for or category,
        "showcases": list(showcases or [])[:8],
    }


# Default movie/TV brands each public figure showcases (when no title is equipped in UI)
SHOWCASES = {
    "Pedro Pascal": ["The Mandalorian", "The Last of Us", "Narcos"],
    "Zendaya": ["Dune", "Euphoria", "Spider-Man: No Way Home"],
    "Timothée Chalamet": ["Dune", "Dune: Part Two", "Call Me by Your Name"],
    "Margot Robbie": ["Barbie", "The Wolf of Wall Street", "Once Upon a Time in Hollywood"],
    "Ryan Gosling": ["Barbie", "La La Land", "Drive"],
    "Florence Pugh": ["Dune: Part Two", "Midsommar", "Oppenheimer"],
    "Austin Butler": ["Dune: Part Two", "Elvis"],
    "Anya Taylor-Joy": ["The Queen's Gambit", "Furiosa", "The Witch"],
    "Keanu Reeves": ["The Matrix", "John Wick"],
    "Scarlett Johansson": ["Her", "Lost in Translation", "Marriage Story"],
    "Tom Cruise": ["Top Gun: Maverick", "Mission: Impossible – Fallout"],
    "Denzel Washington": ["Training Day", "Glory", "Fences"],
    "Meryl Streep": ["The Devil Wears Prada", "Sophie's Choice", "The Iron Lady"],
    "Leonardo DiCaprio": ["Inception", "The Revenant", "The Wolf of Wall Street", "Titanic"],
    "Jennifer Lawrence": ["The Hunger Games", "Silver Linings Playbook", "Don't Look Up"],
    "Chris Hemsworth": ["Thor", "Extraction"],
    "Gal Gadot": ["Wonder Woman", "Red Notice"],
    "Idris Elba": ["Luther", "The Wire", "Thor"],
    "Lupita Nyong'o": ["Black Panther", "12 Years a Slave", "Us"],
    "Cillian Murphy": ["Oppenheimer", "Peaky Blinders", "Inception"],
    "Robert Downey Jr.": ["Iron Man", "Oppenheimer", "Sherlock Holmes"],
    "Chris Evans": ["Captain America", "Knives Out"],
    "Tom Holland": ["Spider-Man: No Way Home", "The Crowded Room"],
    "Andrew Garfield": ["Spider-Man", "Tick, Tick... Boom!", "The Social Network"],
    "Oscar Isaac": ["Dune", "Moon Knight", "Ex Machina"],
    "John Boyega": ["Star Wars: The Force Awakens", "Attack the Block"],
    "Letitia Wright": ["Black Panther", "Surrounded"],
    "Michael B. Jordan": ["Black Panther", "Creed", "Fruitvale Station"],
    "Rami Malek": ["Bohemian Rhapsody", "Mr. Robot", "No Time to Die"],
    "Sydney Sweeney": ["Euphoria", "Anyone But You", "The White Lotus"],
    "Jenna Ortega": ["Wednesday", "Scream", "Beetlejuice Beetlejuice"],
    "Millie Bobby Brown": ["Stranger Things", "Enola Holmes"],
    "Henry Cavill": ["The Witcher", "Man of Steel", "Mission: Impossible – Fallout"],
    "Jason Momoa": ["Aquaman", "See", "Game of Thrones"],
    "The Rock": ["Jumanji", "Fast & Furious", "Moana"],
    "Vin Diesel": ["Fast & Furious", "Guardians of the Galaxy", "xXx"],
    "Pedro Pascal": ["The Mandalorian", "The Last of Us"],
    "Lady Gaga": ["A Star Is Born", "House of Gucci", "Joker: Folie à Deux"],
    "Beyoncé": ["Black Is King", "Homecoming", "Renaissance"],
    "Taylor Swift": ["The Eras Tour", "Miss Americana", "Cats"],
    "The Weeknd": ["The Idol", "Uncut Gems"],
    "Harry Styles": ["Don't Worry Darling", "My Policeman", "Dunkirk"],
    "Billie Eilish": ["No Time to Die", "Barbie"],
    "Dua Lipa": ["Barbie", "Anora"],
    "Rihanna": ["Ocean's 8", "Battleship", "Guava Island"],
    "Bruno Mars": ["Anderson .Paak Silk Sonic", "Saturday Night Live"],
    "Post Malone": ["Spider-Man: Into the Spider-Verse", "Tommy Boy"],
    "Drake": ["Euphoria", "Top Boy"],
    "Bad Bunny": ["Bullet Train", "Cassandro"],
    "Doja Cat": ["Planet Her visual universe", "Saturday Night Live"],
    "SZA": ["One of Them Days", "Ctrl era films"],
    "Kendrick Lamar": ["Black Panther: The Album", "Mr. Morale"],
    "Travis Scott": ["Utopia", "Astroworld"],
    "BTS": ["Butter", "Permission to Dance On Stage"],
    "BLACKPINK": ["Born Pink", "The Movie"],
    "Oprah Winfrey": ["The Color Purple", "The Oprah Winfrey Show", "Greenleaf"],
    "Gordon Ramsay": ["Hell's Kitchen", "Kitchen Nightmares", "MasterChef"],
    "Anthony Bourdain": ["Parts Unknown", "No Reservations"],
    "David Attenborough": ["Planet Earth", "Blue Planet", "Our Planet"],
    "LeBron James": ["Space Jam: A New Legacy", "Winning Time"],
    "Serena Williams": ["King Richard", "Being Serena"],
    "Tom Brady": ["80 for Brady", "Man in the Arena"],
    "Simone Biles": ["The Simone Biles Story", "Full Out"],
    "Lionel Messi": ["Messi", "Take the Ball Pass the Ball"],
    "Cristiano Ronaldo": ["Ronaldo", "Siuuu documentaries"],
    "Elon Musk": ["Iron Man inspiration lore", "documentary cameos"],
    "Steve Jobs": ["Steve Jobs", "Jobs", "Pirates of Silicon Valley"],
    "Kim Kardashian": ["Keeping Up with the Kardashians", "American Horror Story"],
    "Kanye West": ["jeen-yuhs", "The Life of Pablo film loops"],
    "Pharrell Williams": ["Piece by Piece", "Hidden Figures"],
    "MrBeast": ["Beast Games", "YouTube Originals"],
    "Timothée Chalamet": ["Dune", "Wonka", "Call Me by Your Name"],
    "Zendaya": ["Dune", "Euphoria", "Challengers"],
    "Pedro Pascal": ["The Last of Us", "The Mandalorian", "Gladiator II"],
    "Cillian Murphy": ["Oppenheimer", "Peaky Blinders", "28 Days Later"],
    "Margot Robbie": ["Barbie", "Babylon", "I, Tonya"],
    "Ryan Gosling": ["Barbie", "Blade Runner 2049", "The Notebook"],
    "Keanu Reeves": ["John Wick", "The Matrix", "Constantine"],
    "Tom Cruise": ["Top Gun: Maverick", "Mission: Impossible", "Edge of Tomorrow"],
    "Leonardo DiCaprio": ["Inception", "The Revenant", "Once Upon a Time in Hollywood"],
    "Austin Butler": ["Elvis", "Dune: Part Two", "Once Upon a Time in Hollywood"],
    "Florence Pugh": ["Midsommar", "Little Women", "Don't Worry Darling"],
    "Anya Taylor-Joy": ["The Queen's Gambit", "The Menu", "Furiosa"],
    "Jenna Ortega": ["Wednesday", "Scream VI", "Beetlejuice Beetlejuice"],
    "Sydney Sweeney": ["Euphoria", "The White Lotus", "Immaculate"],
    "Pedro Pascal": ["The Last of Us", "The Mandalorian"],
}


# (name, category, vibe, icons, era?, known_for?)
RAW = [
    # Music
    ("Beyoncé", "music", "regal stage divinity, liquid gold couture, cathedral-scale choreography light", ["gold armor gown", "halo spotlights", "formation silhouettes"], "2010s-2020s", "music"),
    ("Taylor Swift", "music", "fairy-tale stadium sparkle, eras wardrobe montage, confetti rain romance", ["sparkly microphone", "cardigan folklore cottage", "stadium friendship bracelets"], "2010s-2020s", "music"),
    ("Rihanna", "music", "futurist glamour, Fenty-red power, runway-alien chic", ["red carpet sculpture dress", "umbrella silhouette", "beauty empire glow"], "2010s-2020s", "music beauty"),
    ("Lady Gaga", "music", "avant-garde fashion theater, meat-dress myth, opera-pop spectacle", ["crystalline costume", "theatrical mask", "piano in flames energy"], "2010s-2020s", "music"),
    ("Billie Eilish", "music", "oversized street gothic, neon-green whisper, dream-pop shadow", ["baggy streetwear", "green hair streak", "whispering stage"], "2020s", "music"),
    ("Drake", "music", "nocturnal city-king luxury, owl-sigil night, champagne rain", ["OVO owl motif energy", "Toronto skyline night", "stadium hoodie throne"], "2010s-2020s", "music"),
    ("The Weeknd", "music", "after-hours neon noir, bandaged ballad tragedy, red-light cathedral", ["red blazer silhouette", "neon cross motif", "smoke-filled stage"], "2010s-2020s", "music"),
    ("Bad Bunny", "music", "carnival futurism, Puerto Rican heat, gender-fluid fashion riot", ["color-block street couture", "stadium confetti", "reggaeton pulse lights"], "2020s", "music"),
    ("Dua Lipa", "music", "disco-ball modernity, mirrored dancefloor glamour", ["mirrorball light", "sleek catsuit", "retro-future dance floor"], "2020s", "music"),
    ("Harry Styles", "music", "velvet peacock romance, floral masculinity, arena confetti joy", ["floral suit", "pearl earring glint", "feather boa energy"], "2020s", "music"),
    ("Adele", "music", "velvet torch-song cathedral, black gown gravity, tear-glitter intimacy", ["grand piano", "black evening gown", "spotlight haze"], "2010s-2020s", "music"),
    ("Bruno Mars", "music", "retro funk showman, silk-and-brass party engine", ["fedora and silk shirt", "brass section blaze", "dance-floor glitter"], "2010s-2020s", "music"),
    ("SZA", "music", "neo-soul garden melancholy, soft thorns, dusk-purple haze", ["garden of soft chaos", "silk slip dress", "twilight haze"], "2020s", "music"),
    ("Travis Scott", "music", "astro-rave dystopia, rollercoaster myth, cactus-jack neon storm", ["festival night throng", "rollercoaster silhouette", "neon storm clouds"], "2010s-2020s", "music"),
    ("Doja Cat", "music", "shapeshifting meme-glam, paint-and-fur surreal pop", ["body paint patterns", "hyper-color stage", "feline glamour"], "2020s", "music"),
    ("Post Malone", "music", "tattooed folk-trap bard, face-ink constellation, campfire arena", ["face tattoos constellation", "acoustic stadium", "diamond grills glint"], "2010s-2020s", "music"),
    ("Ed Sheeran", "music", "loop-pedal campfire bard, ginger-folk stadium intimacy", ["loop pedals", "acoustic guitar", "fairy lights"], "2010s-2020s", "music"),
    ("BTS", "music", "synchronized purple army, ARMY lightstick ocean, K-pop cosmic polish", ["purple lightstick sea", "sharp coordinated looks", "stadium ocean waves"], "2010s-2020s", "music"),
    ("BLACKPINK", "music", "pink-black hyper-glam, diamond-hard choreography, global girl-group fire", ["pink and black couture", "explosive stage pyro", "diamond stage"], "2010s-2020s", "music"),
    ("Michael Jackson", "music", "moonwalk myth, sequined glove lightning, thriller-fog iconography", ["sparkling glove", "fedora tilt", "moonlit sidewalk"], "1980s-1990s", "music"),
    ("Madonna", "music", "reinvention machine, cone-bra iconoclasm, disco-to-oracle glamour", ["cone bra silhouette", "crucifix chic", "reinvention wardrobe"], "1980s-2000s", "music"),
    ("Prince", "music", "purple rain mysticism, androgynous guitar god, paisley temple", ["purple rain", "cloud guitar shape", "paisley palace"], "1980s", "music"),
    ("David Bowie", "music", "starman chameleon, lightning-bolt face, cosmic fashion lab", ["lightning bolt makeup", "thin white duke suit", "starman cosmos"], "1970s-1990s", "music"),
    ("Elvis Presley", "music", "rhinestone jumpsuit sun-king, hip-shake thunder, neon Vegas chapel", ["white jumpsuit", "gold microphone", "Vegas neon"], "1950s-1970s", "music"),
    # Film / acting
    ("Zendaya", "acting", "silk-red carpet architecture, young-icon gravity, fashion-future elegance", ["architectural gown", "red carpet statuesque pose", "futurist chic"], "2020s", "acting fashion"),
    ("Timothée Chalamet", "acting", "waif-poet heartthrob, velvet youth, art-house magnetism", ["tousled hair silhouette", "velvet suit", "soft tragic eyes energy"], "2020s", "acting"),
    ("Margot Robbie", "acting", "platinum bombshell craft, ice-pink wit, blockbuster polish", ["platinum wave hair", "pink power suit", "movie-star smile energy"], "2010s-2020s", "acting"),
    ("Ryan Gosling", "acting", "cool-blue stoic charm, drive-night jacket myth, soft-spoken heat", ["scorpion-jacket energy", "cool blue night", "quiet intensity"], "2010s-2020s", "acting"),
    ("Florence Pugh", "acting", "earthy firebrand, raw theatrical force, modern classic face", ["bold lip", "period-to-modern wardrobe shifts", "fierce gaze"], "2020s", "acting"),
    ("Pedro Pascal", "acting", "warm rogue charisma, silver-fox tenderness, found-family hero glow", ["weathered smile", "adventure coat", "protective stance"], "2020s", "acting"),
    ("Austin Butler", "acting", "velvet-drawl rockabilly lightning, sculpted old-hollywood return", ["pompadour silhouette", "leather and satin", "stage hips energy"], "2020s", "acting"),
    ("Anya Taylor-Joy", "acting", "porcelain-fey intensity, chess-queen stillness, otherworldly eyes", ["pale porcelain glow", "sharp chess-board geometry", "wide-set intense gaze energy"], "2020s", "acting"),
    ("Keanu Reeves", "acting", "gentle immortal stoicism, black-coat myth, city-night melancholy cool", ["long black coat", "motorcycle night", "calm warrior stance"], "1990s-2020s", "acting"),
    ("Scarlett Johansson", "acting", "ice-glass glamour, spy-elegance, voice-of-AI mystery", ["sleek black tactical chic", "icy blonde glamour", "cool spy silhouette"], "2010s-2020s", "acting"),
    ("Tom Cruise", "acting", "impossible stunt grin, aviator-sun adrenaline, running-toward-camera legend", ["aviator sunglasses", "sprint toward camera", "fighter-jet sky"], "1990s-2020s", "acting"),
    ("Denzel Washington", "acting", "commanding gravitas, preacher-to-king voice, moral-steel presence", ["sharp tailored suit", "commanding stance", "stormy dignity"], "1990s-2020s", "acting"),
    ("Meryl Streep", "acting", "chameleon mastery, diamond-sharp wit, awards-season goddess", ["transformation wardrobe", "knowing smile", "stage-and-screen gravity"], "1980s-2020s", "acting"),
    ("Leonardo DiCaprio", "acting", "eco-prince intensity, ocean-eyes obsession, prestige-epic fire", ["intense blue-eyed stare energy", "period adventure coat", "ship-deck wind"], "1990s-2020s", "acting"),
    ("Jennifer Lawrence", "acting", "unruly star honesty, huntress spark, red-carpet mischief", ["braided huntress energy", "candid laugh", "fiery presence"], "2010s-2020s", "acting"),
    ("Chris Hemsworth", "acting", "sun-god muscle myth, storm-hammer thunder, beach-hero ease", ["storm sky", "muscular hero silhouette", "mythic hammer energy"], "2010s-2020s", "acting"),
    ("Gal Gadot", "acting", "amazonian light, warrior-crown grace, desert-gold strength", ["warrior tiara energy", "golden armor light", "desert heroism"], "2010s-2020s", "acting"),
    ("Idris Elba", "acting", "velvet bass-voice command, tailored king energy, nightclub-to-throne range", ["impeccable suit", "deep presence", "night-city cool"], "2010s-2020s", "acting"),
    ("Lupita Nyong'o", "acting", "sculptural elegance, luminous dark-skin glow, activist-artist poise", ["sculptural gown", "radiant skin light", "poised regal stance"], "2010s-2020s", "acting"),
    ("Cillian Murphy", "acting", "ice-blue haunted intellect, quiet-bomb intensity, peaky silhouette", ["piercing pale eyes energy", "lean sharp silhouette", "smoke-and-shadow mood"], "2000s-2020s", "acting"),
    ("Austin Butler", "acting", "rockabilly lightning", ["pompadour"], "2020s", "acting"),  # may dedupe
    # Sports
    ("Serena Williams", "sports", "court-queen power, catsuit defiance, champion roar", ["tennis court throne", "champion roar", "powerful serve freeze"], "2000s-2020s", "tennis"),
    ("LeBron James", "sports", "skyline athlete-king, crown-of-Akron myth, championship gravity", ["basketball arena lights", "crown motif energy", "mid-flight dunk silhouette"], "2010s-2020s", "basketball"),
    ("Lionel Messi", "sports", "magician-left-foot poetry, Barcelona-to-world pilgrimage", ["soccer ball levitation", "number 10 aura", "stadium ocean"], "2010s-2020s", "soccer"),
    ("Cristiano Ronaldo", "sports", "sculpted goal-machine, SIUUU sky-point, brand-empire athleticism", ["sky-point celebration", "ripped athletic form", "stadium lights"], "2010s-2020s", "soccer"),
    ("Simone Biles", "sports", "defying-gravity vault goddess, glitter-leotard comet", ["gymnastics vault midair", "glitter leotard", "impossible twist"], "2010s-2020s", "gymnastics"),
    ("Michael Jordan", "sports", "tongue-out flight myth, red-and-black dynasty, sneaker-temple legend", ["airborne dunk silhouette", "red black jersey energy", "sneaker temple"], "1990s", "basketball"),
    ("Usain Bolt", "sports", "lightning-bolt sprint god, to-the-world pose, pure speed streak", ["lightning sprint blur", "victory pose", "track stadium"], "2010s", "track"),
    ("Naomi Osaka", "sports", "quiet-storm champion, anime-mask art activism, precision power", ["tennis hardcourt", "artistic face-mask energy", "focused champion stare"], "2020s", "tennis"),
    ("Tom Brady", "sports", "dynasty quarterback ice, GOAT aura, late-game comeback calm", ["football spiral", "super bowl confetti", "ice-vein calm"], "2000s-2020s", "football"),
    ("Sha'Carri Richardson", "sports", "orange-flame sprint, nail-art thunder, unapologetic velocity", ["orange hair flame", "sprint explosion", "track spikes lightning"], "2020s", "track"),
    # Fashion / beauty / creators
    ("Rihanna Fenty", "fashion", "beauty-mogul empire glow, Savage runway body-joy", ["beauty desk glow", "runway swagger", "red lipstick empire"], "2020s", "fashion beauty"),
    ("Kim Kardashian", "influencer", "contour-sculpt fame architecture, desert-met-gala myth, reality-empire gloss", ["sculpted glam silhouette", "desert gown", "flash photography storm"], "2010s-2020s", "media"),
    ("Kanye West", "music", "yeezy-minimal prophet, industrial-church fashion, storm-cloud genius myth", ["neutral yeezy palette", "industrial stage", "masked silhouette"], "2010s-2020s", "music fashion"),
    ("Pharrell Williams", "music", "hat-mountain joy, pastel-happy genius, Louis Vuitton futurism", ["oversized hat energy", "pastel joy", "futurist fashion lab"], "2000s-2020s", "music fashion"),
    ("Zendaya Fashion", "fashion", "shape-shifting red-carpet architecture", ["sculptural gown"], "2020s", "fashion"),
    ("Emma Chamberlain", "influencer", "messy-cool internet darling, iced-coffee candid, thrift-chic chaos", ["iced coffee", "candid vlog energy", "thrift layers"], "2020s", "creator"),
    ("MrBeast", "influencer", "spectacle philanthropy carnival, green-logo chaos, challenge-empire kinetic", ["giant challenge set", "crowd spectacle", "logo-green energy"], "2020s", "creator"),
    ("Charli D'Amelio", "influencer", "tiktok-dance clean-cut fame, soft-gen-z polish", ["dance studio lights", "phone-camera frame", "clean aesthetic"], "2020s", "creator"),
    # Comedy / hosts / media
    ("Oprah Winfrey", "media", "empath-empress talk-show sun, book-club gospel, generosity light", ["talk-show chair throne", "warm golden key light", "audience sea"], "1990s-2020s", "media"),
    ("Trevor Noah", "media", "sharp global wit, late-night desk cool, immigrant-polyglot sparkle", ["late-night desk", "world map energy", "sharp suit wit"], "2010s-2020s", "media"),
    ("Stephen Colbert", "media", "satire-host grin, desk-and-stars patriotism parody", ["late-night desk", "stars and stripes energy", "ironic grin"], "2010s-2020s", "media"),
    ("Jimmy Fallon", "media", "boyish variety-show sparkle, lip-sync chaos joy", ["variety show stage", "house band lights", "playful chaos"], "2010s-2020s", "media"),
    # Tech / business figures (public)
    ("Elon Musk", "tech", "meme-lord industrialist, rocket-and-robot myth, cybertruck angles", ["rocket launch sky", "futurist vehicle angles", "mission-control glow"], "2020s", "tech"),
    ("Mark Zuckerberg", "tech", "metaverse grey-tee oracle, VR-horizon bland-king energy", ["VR headset world", "infinite grey office", "digital double motif"], "2010s-2020s", "tech"),
    ("Steve Jobs", "tech", "black-turtleneck zen, product-reveal temple, reality-distortion glow", ["black turtleneck", "glass stage product pedestal", "keynote spotlight"], "2000s", "tech"),
    ("Tim Cook", "tech", "quiet apple-temple steward, glass-cube calm", ["glass cube store", "minimal product altar", "clean white light"], "2010s-2020s", "tech"),
    # International / icons
    ("Ronaldo Nazário", "sports", "original R9 lightning", ["soccer brilliance"], "1990s-2000s", "soccer"),
    ("Pele", "sports", "eternal football saint, Santos sun", ["golden era soccer", "number 10 myth"], "1960s-1970s", "soccer"),
    ("Muhammad Ali", "sports", "butterfly-and-bee poetry, rope-a-dope legend, civil-rights thunder", ["boxing ring lights", "victory arms raised", "poetic fighter stance"], "1960s-1970s", "boxing"),
    ("Audrey Hepburn", "acting", "little-black-dress eternal, gamine grace, roman-holiday light", ["little black dress", "tiara breakfast elegance", "bicycle roman street"], "1950s-1960s", "acting"),
    ("Marilyn Monroe", "acting", "subway-grate blonde myth, diamond-breath glamour, soft-focus legend", ["white subway dress energy", "platinum curls", "diamond smile"], "1950s", "acting"),
    ("James Dean", "acting", "red-jacket rebel, cigarette-dusk cool, forever-young myth", ["red windbreaker", "motorcycle dusk", "brooding cool"], "1950s", "acting"),
    ("Frida Kahlo", "art", "unibrow flower-crown pain-and-power, surreal self-altar", ["flower crown", "self-portrait studio", "bold color folk"], "1930s-1950s", "art"),
    ("Andy Warhol", "art", "silver-factory pop saint, soup-can oracle, white-wig cool", ["silver factory", "screenprint colors", "white wig silhouette"], "1960s-1980s", "art"),
    ("Banksy", "art", "anonymous stencil ghost, rat-and-balloon myth, street-oracle", ["stencil wall rat", "balloon girl energy", "anonymous hood"], "2000s-2020s", "art"),
    ("Dolly Parton", "music", "rhinestone country goddess, butterfly-coat joy, generosity sparkle", ["rhinestone gown", "butterfly motif", "blonde tower glamour"], "1970s-2020s", "music"),
    ("Johnny Cash", "music", "man-in-black pilgrimage, railroad righteousness", ["black suit", "acoustic guitar", "prison-concert myth"], "1960s-1970s", "music"),
    ("Aretha Franklin", "music", "queen-of-soul cathedral, fur-and-gospel power", ["fur coat majesty", "gospel piano", "crown of soul"], "1960s-1980s", "music"),
    ("Whitney Houston", "music", "voice-of-angels stadium, white-gown divine", ["white gown spotlight", "soaring vocal energy", "stadium hush"], "1980s-1990s", "music"),
    ("Bob Marley", "music", "lion-of-zion smoke-and-sun, dreadlock freedom myth", ["rasta colors", "dreadlock silhouette", "sunlit smoke"], "1970s", "music"),
    ("Freddie Mercury", "music", "mustache-god opera rock, yellow-jacket forever, crowd-wave command", ["yellow military jacket", "half-mic stand", "stadium arms wide"], "1970s-1980s", "music"),
    ("Kurt Cobain", "music", "grunge-angel thrift, mothball cardigan myth, raw-nerve quiet", ["striped sweater", "blonde grunge hair", "smashed guitar energy"], "1990s", "music"),
    ("Tupac Shakur", "music", "bandana prophet, thug-life poetry, west-coast sunset fire", ["bandana forehead", "cross necklace", "sunset mural energy"], "1990s", "music"),
    ("The Notorious B.I.G.", "music", "brooklyn crown, coogi-knit king, smoke-cloud baritone", ["coogi sweater", "brooklyn crown", "smoke lounge"], "1990s", "music"),
    ("Jay-Z", "music", "blueprint mogul cool, diamond dynasty, brooklyn-to-boardroom", ["diamond hand signs energy", "black tuxedo cool", "skyline empire"], "2000s-2020s", "music business"),
    ("Nicki Minaj", "music", "barbie-rap shapeshifter, pink-wig supernova", ["pink wig explosion", "Barbie-pink chaos", "rap-queen throne"], "2010s-2020s", "music"),
    ("Cardi B", "music", "bronx-glam thunder, nail-dagger wit, invincible confidence", ["extravagant nails", "bold glam", "money-rain energy"], "2010s-2020s", "music"),
    ("Megan Thee Stallion", "music", "hot-girl summer titan, metallic amazon, Houston heat", ["metallic bodysuit", "powerful stance", "summer heat haze"], "2020s", "music"),
    ("Ice Spice", "music", "munch-cat soft-drill, baddie-bang aesthetic", ["bangs and soft glam", "drill-pop stage", "pink-black palette"], "2020s", "music"),
    ("Olivia Rodrigo", "music", "sour-pop heartbreak diary, purple teen rage glitter", ["purple sour aesthetic", "diary confessional", "teen-angst glitter"], "2020s", "music"),
    ("Sabrina Carpenter", "music", "short-n-sweet coquette pop, espresso wit, blonde-stage sparkle", ["coquette bows", "espresso cup motif", "sparkly mini stage"], "2020s", "music"),
    ("Chappell Roan", "music", "midwest-princess drag-pop maximalism, neon-pink camp", ["neon pink hair", "drag-pop costume", "midwest carnival"], "2020s", "music"),
    ("Lorde", "music", "melodrama pure-heroine cool, tennis-court emptiness, art-pop frost", ["tennis court empty", "cool art-pop minimal", "youthful frost"], "2010s-2020s", "music"),
    ("Frank Ocean", "music", "blonde-album night drive, queer-ocean melancholy, orange-haze confessional", ["night drive neon", "orange aesthetic", "confessional booth"], "2010s-2020s", "music"),
    ("Tyler, the Creator", "music", "golf-wang color chaos, flower-boy garden, call-me-if-you-get-lost travel", ["flower boy garden", "bold color blocks", "odd-future energy"], "2010s-2020s", "music"),
    ("Kendrick Lamar", "music", "compton-poet crown, jazz-rap cathedral, superbowl sermon fire", ["poet crown energy", "compton mural", "mic-sermon stage"], "2010s-2020s", "music"),
    ("J. Cole", "music", "dreamville earnest, forest-hills storyteller", ["storyteller mic", "carolina night", "earnest stage"], "2010s-2020s", "music"),
    ("Lizzo", "music", "flute-body-positive glitter joy, disco-self-love explosion", ["crystal flute", "body-positive glam", "disco confetti"], "2020s", "music"),
    ("John Cena", "sports", "you-cant-see-me wrestle-myth, blue-fringe patriotism", ["wrestling ring", "invisible wave gesture energy", "blue fringe jacket"], "2000s-2020s", "wrestling"),
    ("The Rock", "acting", "eyebrow-raise thunder, people-champion grin, muscle-island myth", ["raised eyebrow energy", "blockbuster muscle silhouette", "island adventure"], "2000s-2020s", "acting sports"),
    ("Vin Diesel", "acting", "family-table diesel myth, bald-chrome intensity", ["fast family table", "chrome bald intensity", "muscle car night"], "2000s-2020s", "acting"),
    ("Jason Momoa", "acting", "aquaman ocean-king, rock-and-braid wildness", ["ocean king silhouette", "braided warrior", "rock-and-roll beach"], "2010s-2020s", "acting"),
    ("Henry Cavill", "acting", "super-man jawline myth, witcher-white-hair warrior", ["hero jawline energy", "fantasy warrior armor", "old-world steel"], "2010s-2020s", "acting"),
    ("Sydney Sweeney", "acting", "blonde bombshell return, euphoria glitter residue, american-sweetheart heat", ["glitter tears energy", "blonde classic glamour", "red carpet heat"], "2020s", "acting"),
    ("Jenna Ortega", "acting", "wednesday-black ballet of doom, gen-z gothic icon", ["black ballet dress energy", "deadpan gothic", "cello shadow"], "2020s", "acting"),
    ("Millie Bobby Brown", "acting", "eleven-fuzz-//-fashion-grown glow", ["shaved-head light energy", "waffle motif soft", "growing-star polish"], "2010s-2020s", "acting"),
    ("Tom Holland", "acting", "boy-next-door web-sling charm, stage-musical spark", ["friendly neighborhood energy", "stage dance spark", "youthful hero"], "2010s-2020s", "acting"),
    ("Andrew Garfield", "acting", "empath-eyes intensity, broadway-raw nerve", ["vulnerable intensity", "theater stage raw", "web-heart energy"], "2010s-2020s", "acting"),
    ("Robert Downey Jr.", "acting", "arc-reactor showman, snark-genius armor, hollywood resurrection", ["arc reactor glow energy", "showman suit", "genius workshop"], "2010s-2020s", "acting"),
    ("Chris Evans", "acting", "all-american shield calm, soft-hero decency", ["shield circle energy", "all-american hero", "quiet courage"], "2010s-2020s", "acting"),
    ("Scarlett Witch energy", "acting", "chaos magic red", ["red chaos energy"], "2020s", "acting"),
    ("Rami Malek", "acting", "sharp-angular intensity, bohemian-rhapsody micro-expressions", ["angular face energy", "stage Freddie-myth pose energy", "intense stillness"], "2010s-2020s", "acting"),
    ("Oscar Isaac", "acting", "velvet-latin intensity, scoundrel-poet eyes", ["poet scoundrel gaze", "leather adventure coat", "starfield mystery"], "2010s-2020s", "acting"),
    ("John Boyega", "acting", "storm-of-conscience hero heat, london-to-galaxy fire", ["rebel heat", "stormtrooper-white contrast energy", "fierce loyalty"], "2010s-2020s", "acting"),
    ("Letitia Wright", "acting", "vibranium-sister genius spark, wakanda-bright hope", ["tech genius energy", "bright hope stance", "futurist lab"], "2010s-2020s", "acting"),
    ("Michael B. Jordan", "acting", "sculpted intensity, creed-fire, smoke-and-muscle poetry", ["boxing training haze", "sculpted silhouette", "smoldering stare"], "2010s-2020s", "acting"),
    ("Zendaya", "acting", "silk-red carpet architecture", ["architectural gown"], "2020s", "acting"),  # duplicate name ok with same slug
    ("Timothée Chalamet", "acting", "waif-poet", ["velvet"], "2020s", "acting"),
    ("Bill Gates", "tech", "philanthropy-nerd sweater empire, soft-spoken planet scale", ["sweater tech sage", "philanthropy globe", "quiet boardroom"], "1990s-2020s", "tech"),
    ("Jeff Bezos", "tech", "rocket-and-logistics titan, bald-empire grin", ["rocket blue origin energy", "logistics empire", "yacht-scale ambition"], "2010s-2020s", "tech"),
    ("Oprah", "media", "empath-empress", ["talk show throne"], "1990s-2020s", "media"),
    ("Ellen DeGeneres", "media", "daytime dance host sparkle", ["dance stage"], "2000s-2010s", "media"),
    ("Joe Rogan", "media", "smoke-filled longform cave, hunt-and-discourse energy", ["podcast cave red lights", "long-form desk", "hunt-lodge vibe"], "2010s-2020s", "media"),
    ("Gordon Ramsay", "food", "hells-kitchen inferno chef, roaring perfectionism", ["flames kitchen", "chef whites fury energy", "perfect plate"], "2000s-2020s", "food"),
    ("Anthony Bourdain", "food", "travel-noir food pilgrim, cigarette-and-street-table honesty", ["street food night", "travel journal", "noir kitchen"], "2000s-2010s", "food"),
    ("Martha Stewart", "lifestyle", "perfect-home oracle, linen-and-garden empire", ["immaculate kitchen", "garden harvest", "crisp lifestyle set"], "1990s-2020s", "lifestyle"),
    ("Gwyneth Paltrow", "lifestyle", "goop-candle mysticism, pale wellness temple", ["candlelit wellness", "pale linen temple", "luxury cleanse aesthetic"], "2010s-2020s", "lifestyle"),
    ("David Attenborough", "media", "whisper-of-earth documentary god, green-planet awe", ["lush jungle", "whispered wonder", "wildlife cathedral"], "1990s-2020s", "media"),
    ("Neil deGrasse Tyson", "science", "cosmic-explainer starfield, bowtie-of-science energy", ["starfield cosmos", "planetarium glow", "explainer chalkboard"], "2010s-2020s", "science"),
    ("Greta Thunberg", "activism", "climate-prophet braids, quiet rage of future", ["braided determination", "protest sign energy", "stormy seacoast"], "2020s", "activism"),
    ("Malala Yousafzai", "activism", "book-and-bravery light, education-halo courage", ["books and light", "schoolroom hope", "quiet courage"], "2010s-2020s", "activism"),
    ("Pope Francis", "world", "white-robed humility spectacle, global-balcony grace", ["white robes", "vatican balcony energy", "humble procession"], "2010s-2020s", "world"),
    ("King Charles III", "world", "royal pageantry, crown-and-carriage ceremony", ["crown jewels ceremony", "carriage procession", "royal pageant"], "2020s", "world"),
    ("Princess Diana", "world", "people's princess myth, revenge-dress lightning, humanitarian glow", ["revenge dress energy", "tiara soft light", "crowd of flashbulbs"], "1980s-1990s", "world"),
    ("Jackie Kennedy", "world", "pillbox-hat elegy, camelot pink myth", ["pillbox hat", "pink suit icon energy", "camelot grace"], "1960s", "world"),
]


def main():
    seen = set()
    out = []
    for row in RAW:
        name, cat, vibe, icons = row[0], row[1], row[2], row[3]
        era = row[4] if len(row) > 4 else "contemporary"
        known = row[5] if len(row) > 5 else cat
        shows = SHOWCASES.get(name) or []
        c = C(name, cat, vibe, icons, era, known, shows)
        if c["id"] in seen:
            # merge showcases if re-defined
            for existing in out:
                if existing["id"] == c["id"]:
                    merged = list(dict.fromkeys((existing.get("showcases") or []) + shows))
                    existing["showcases"] = merged[:8]
                    break
            continue
        seen.add(c["id"])
        out.append(c)
    out.sort(key=lambda x: (x["category"], x["name"].lower()))
    cats = sorted({c["category"] for c in out})
    data = {
        "version": 2,
        "description": "Celebrities as brand ambassadors who showcase movie/TV entertainment brands (showcases + equipped titles).",
        "categories": cats,
        "celebrities": out,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with_shows = sum(1 for c in out if c.get("showcases"))
    print(f"Wrote {len(out)} celebrities ({with_shows} with showcases) → {OUT}")
    print("categories:", ", ".join(cats))


if __name__ == "__main__":
    main()
