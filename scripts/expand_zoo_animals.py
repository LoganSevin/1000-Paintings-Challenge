"""Append more featured animals to data/zoo-catalog.json."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "data" / "zoo-catalog.json"

CLASS = {
    "mammals": ("Chordata", "Mammalia"),
    "birds": ("Chordata", "Aves"),
    "reptiles": ("Chordata", "Reptilia"),
    "amphibians": ("Chordata", "Amphibia"),
    "bony-fish": ("Chordata", "Actinopterygii"),
    "cart-fish": ("Chordata", "Chondrichthyes"),
    "insects": ("Arthropoda", "Insecta"),
    "arachnids": ("Arthropoda", "Arachnida"),
    "molluscs": ("Mollusca", "Cephalopoda"),
    "cnidarians": ("Cnidaria", "Scyphozoa"),
    "echinoderms": ("Echinodermata", "Asteroidea"),
}

# id, common, scientific, classId, order, family, genus, class_override, phylum_override
ROWS = [
    ("cheetah", "Cheetah", "Acinonyx jubatus", "mammals", "Carnivora", "Felidae", "Acinonyx"),
    ("leopard", "Leopard", "Panthera pardus", "mammals", "Carnivora", "Felidae", "Panthera"),
    ("snow-leopard", "Snow leopard", "Panthera uncia", "mammals", "Carnivora", "Felidae", "Panthera"),
    ("cougar", "Cougar", "Puma concolor", "mammals", "Carnivora", "Felidae", "Puma"),
    ("lynx", "Eurasian lynx", "Lynx lynx", "mammals", "Carnivora", "Felidae", "Lynx"),
    ("polar-bear", "Polar bear", "Ursus maritimus", "mammals", "Carnivora", "Ursidae", "Ursus"),
    ("hyena", "Spotted hyena", "Crocuta crocuta", "mammals", "Carnivora", "Hyaenidae", "Crocuta"),
    ("meerkat", "Meerkat", "Suricata suricatta", "mammals", "Carnivora", "Herpestidae", "Suricata"),
    ("raccoon", "Raccoon", "Procyon lotor", "mammals", "Carnivora", "Procyonidae", "Procyon"),
    ("sea-otter", "Sea otter", "Enhydra lutris", "mammals", "Carnivora", "Mustelidae", "Enhydra"),
    ("wolverine", "Wolverine", "Gulo gulo", "mammals", "Carnivora", "Mustelidae", "Gulo"),
    ("arctic-fox", "Arctic fox", "Vulpes lagopus", "mammals", "Carnivora", "Canidae", "Vulpes"),
    ("fennec", "Fennec fox", "Vulpes zerda", "mammals", "Carnivora", "Canidae", "Vulpes"),
    ("giraffe", "Giraffe", "Giraffa camelopardalis", "mammals", "Artiodactyla", "Giraffidae", "Giraffa"),
    ("hippo", "Hippopotamus", "Hippopotamus amphibius", "mammals", "Artiodactyla", "Hippopotamidae", "Hippopotamus"),
    ("white-rhino", "White rhinoceros", "Ceratotherium simum", "mammals", "Perissodactyla", "Rhinocerotidae", "Ceratotherium"),
    ("plains-zebra", "Plains zebra", "Equus quagga", "mammals", "Perissodactyla", "Equidae", "Equus"),
    ("moose", "Moose", "Alces alces", "mammals", "Artiodactyla", "Cervidae", "Alces"),
    ("reindeer", "Reindeer", "Rangifer tarandus", "mammals", "Artiodactyla", "Cervidae", "Rangifer"),
    ("american-bison", "American bison", "Bison bison", "mammals", "Artiodactyla", "Bovidae", "Bison"),
    ("dromedary", "Dromedary", "Camelus dromedarius", "mammals", "Artiodactyla", "Camelidae", "Camelus"),
    ("capybara", "Capybara", "Hydrochoerus hydrochaeris", "mammals", "Rodentia", "Caviidae", "Hydrochoerus"),
    ("beaver", "North American beaver", "Castor canadensis", "mammals", "Rodentia", "Castoridae", "Castor"),
    ("hedgehog", "European hedgehog", "Erinaceus europaeus", "mammals", "Eulipotyphla", "Erinaceidae", "Erinaceus"),
    ("koala", "Koala", "Phascolarctos cinereus", "mammals", "Diprotodontia", "Phascolarctidae", "Phascolarctos"),
    ("wombat", "Common wombat", "Vombatus ursinus", "mammals", "Diprotodontia", "Vombatidae", "Vombatus"),
    ("tasmanian-devil", "Tasmanian devil", "Sarcophilus harrisii", "mammals", "Dasyuromorphia", "Dasyuridae", "Sarcophilus"),
    ("chimpanzee", "Chimpanzee", "Pan troglodytes", "mammals", "Primates", "Hominidae", "Pan"),
    ("orangutan", "Bornean orangutan", "Pongo pygmaeus", "mammals", "Primates", "Hominidae", "Pongo"),
    ("ring-tailed-lemur", "Ring-tailed lemur", "Lemur catta", "mammals", "Primates", "Lemuridae", "Lemur"),
    ("three-toed-sloth", "Brown-throated sloth", "Bradypus variegatus", "mammals", "Pilosa", "Bradypodidae", "Bradypus"),
    ("giant-anteater", "Giant anteater", "Myrmecophaga tridactyla", "mammals", "Pilosa", "Myrmecophagidae", "Myrmecophaga"),
    ("nine-banded-armadillo", "Nine-banded armadillo", "Dasypus novemcinctus", "mammals", "Cingulata", "Dasypodidae", "Dasypus"),
    ("walrus", "Walrus", "Odobenus rosmarus", "mammals", "Carnivora", "Odobenidae", "Odobenus"),
    ("harbor-seal", "Harbor seal", "Phoca vitulina", "mammals", "Carnivora", "Phocidae", "Phoca"),
    ("west-indian-manatee", "West Indian manatee", "Trichechus manatus", "mammals", "Sirenia", "Trichechidae", "Trichechus"),
    ("humpback-whale", "Humpback whale", "Megaptera novaeangliae", "mammals", "Artiodactyla", "Balaenopteridae", "Megaptera"),
    ("sperm-whale", "Sperm whale", "Physeter macrocephalus", "mammals", "Artiodactyla", "Physeteridae", "Physeter"),
    ("narwhal", "Narwhal", "Monodon monoceros", "mammals", "Artiodactyla", "Monodontidae", "Monodon"),
    ("okapi", "Okapi", "Okapia johnstoni", "mammals", "Artiodactyla", "Giraffidae", "Okapia"),
    ("brazilian-tapir", "South American tapir", "Tapirus terrestris", "mammals", "Perissodactyla", "Tapiridae", "Tapirus"),
    ("flying-fox", "Large flying fox", "Pteropus vampyrus", "mammals", "Chiroptera", "Pteropodidae", "Pteropus"),
    ("peregrine-falcon", "Peregrine falcon", "Falco peregrinus", "birds", "Falconiformes", "Falconidae", "Falco"),
    ("harpy-eagle", "Harpy eagle", "Harpia harpyja", "birds", "Accipitriformes", "Accipitridae", "Harpia"),
    ("snowy-owl", "Snowy owl", "Bubo scandiacus", "birds", "Strigiformes", "Strigidae", "Bubo"),
    ("barn-owl", "Barn owl", "Tyto alba", "birds", "Strigiformes", "Tytonidae", "Tyto"),
    ("atlantic-puffin", "Atlantic puffin", "Fratercula arctica", "birds", "Charadriiformes", "Alcidae", "Fratercula"),
    ("wandering-albatross", "Wandering albatross", "Diomedea exulans", "birds", "Procellariiformes", "Diomedeidae", "Diomedea"),
    ("toco-toucan", "Toco toucan", "Ramphastos toco", "birds", "Piciformes", "Ramphastidae", "Ramphastos"),
    ("ruby-throated-hummingbird", "Ruby-throated hummingbird", "Archilochus colubris", "birds", "Apodiformes", "Trochilidae", "Archilochus"),
    ("common-raven", "Common raven", "Corvus corax", "birds", "Passeriformes", "Corvidae", "Corvus"),
    ("mute-swan", "Mute swan", "Cygnus olor", "birds", "Anseriformes", "Anatidae", "Cygnus"),
    ("mallard", "Mallard", "Anas platyrhynchos", "birds", "Anseriformes", "Anatidae", "Anas"),
    ("great-blue-heron", "Great blue heron", "Ardea herodias", "birds", "Pelecaniformes", "Ardeidae", "Ardea"),
    ("brown-pelican", "Brown pelican", "Pelecanus occidentalis", "birds", "Pelecaniformes", "Pelecanidae", "Pelecanus"),
    ("andean-condor", "Andean condor", "Vultur gryphus", "birds", "Cathartiformes", "Cathartidae", "Vultur"),
    ("southern-cassowary", "Southern cassowary", "Casuarius casuarius", "birds", "Casuariiformes", "Casuariidae", "Casuarius"),
    ("north-island-brown-kiwi", "North Island brown kiwi", "Apteryx mantelli", "birds", "Apterygiformes", "Apterygidae", "Apteryx"),
    ("secretarybird", "Secretarybird", "Sagittarius serpentarius", "birds", "Accipitriformes", "Sagittariidae", "Sagittarius"),
    ("whooping-crane", "Whooping crane", "Grus americana", "birds", "Gruiformes", "Gruidae", "Grus"),
    ("common-kingfisher", "Common kingfisher", "Alcedo atthis", "birds", "Coraciiformes", "Alcedinidae", "Alcedo"),
    ("american-alligator", "American alligator", "Alligator mississippiensis", "reptiles", "Crocodilia", "Alligatoridae", "Alligator"),
    ("saltwater-crocodile", "Saltwater crocodile", "Crocodylus porosus", "reptiles", "Crocodilia", "Crocodylidae", "Crocodylus"),
    ("gila-monster", "Gila monster", "Heloderma suspectum", "reptiles", "Squamata", "Helodermatidae", "Heloderma"),
    ("green-iguana", "Green iguana", "Iguana iguana", "reptiles", "Squamata", "Iguanidae", "Iguana"),
    ("tokay-gecko", "Tokay gecko", "Gekko gecko", "reptiles", "Squamata", "Gekkonidae", "Gekko"),
    ("western-diamondback", "Western diamondback rattlesnake", "Crotalus atrox", "reptiles", "Squamata", "Viperidae", "Crotalus"),
    ("green-anaconda", "Green anaconda", "Eunectes murinus", "reptiles", "Squamata", "Boidae", "Eunectes"),
    ("leatherback", "Leatherback sea turtle", "Dermochelys coriacea", "reptiles", "Testudines", "Dermochelyidae", "Dermochelys"),
    ("tuatara", "Tuatara", "Sphenodon punctatus", "reptiles", "Rhynchocephalia", "Sphenodontidae", "Sphenodon"),
    ("bearded-dragon", "Central bearded dragon", "Pogona vitticeps", "reptiles", "Squamata", "Agamidae", "Pogona"),
    ("american-bullfrog", "American bullfrog", "Lithobates catesbeianus", "amphibians", "Anura", "Ranidae", "Lithobates"),
    ("fire-salamander", "Fire salamander", "Salamandra salamandra", "amphibians", "Urodela", "Salamandridae", "Salamandra"),
    ("golden-poison-frog", "Golden poison frog", "Phyllobates terribilis", "amphibians", "Anura", "Dendrobatidae", "Phyllobates"),
    ("hellbender", "Hellbender", "Cryptobranchus alleganiensis", "amphibians", "Urodela", "Cryptobranchidae", "Cryptobranchus"),
    ("eastern-newt", "Eastern newt", "Notophthalmus viridescens", "amphibians", "Urodela", "Salamandridae", "Notophthalmus"),
    ("tomato-frog", "Tomato frog", "Dyscophus antongilii", "amphibians", "Anura", "Microhylidae", "Dyscophus"),
    ("clownfish", "Ocellaris clownfish", "Amphiprion ocellaris", "bony-fish", "Perciformes", "Pomacentridae", "Amphiprion"),
    ("blue-tang", "Palette surgeonfish", "Paracanthurus hepatus", "bony-fish", "Perciformes", "Acanthuridae", "Paracanthurus"),
    ("atlantic-salmon", "Atlantic salmon", "Salmo salar", "bony-fish", "Salmoniformes", "Salmonidae", "Salmo"),
    ("electric-eel", "Electric eel", "Electrophorus electricus", "bony-fish", "Gymnotiformes", "Gymnotidae", "Electrophorus"),
    ("coelacanth", "West Indian Ocean coelacanth", "Latimeria chalumnae", "bony-fish", "Coelacanthiformes", "Latimeriidae", "Latimeria"),
    ("moray", "Mediterranean moray", "Muraena helena", "bony-fish", "Anguilliformes", "Muraenidae", "Muraena"),
    ("whale-shark", "Whale shark", "Rhincodon typus", "cart-fish", "Orectolobiformes", "Rhincodontidae", "Rhincodon"),
    ("great-hammerhead", "Great hammerhead", "Sphyrna mokarran", "cart-fish", "Carcharhiniformes", "Sphyrnidae", "Sphyrna"),
    ("manta-ray", "Giant oceanic manta ray", "Mobula birostris", "cart-fish", "Myliobatiformes", "Mobulidae", "Mobula"),
    ("praying-mantis", "European mantis", "Mantis religiosa", "insects", "Mantodea", "Mantidae", "Mantis"),
    ("luna-moth", "Luna moth", "Actias luna", "insects", "Lepidoptera", "Saturniidae", "Actias"),
    ("atlas-moth", "Atlas moth", "Attacus atlas", "insects", "Lepidoptera", "Saturniidae", "Attacus"),
    ("morpho", "Blue morpho", "Morpho peleides", "insects", "Lepidoptera", "Nymphalidae", "Morpho"),
    ("seven-spot-ladybird", "Seven-spot ladybird", "Coccinella septempunctata", "insects", "Coleoptera", "Coccinellidae", "Coccinella"),
    ("hercules-beetle", "Hercules beetle", "Dynastes hercules", "insects", "Coleoptera", "Scarabaeidae", "Dynastes"),
    ("common-green-darner", "Common green darner", "Anax junius", "insects", "Odonata", "Aeshnidae", "Anax"),
    ("firefly", "Common eastern firefly", "Photinus pyralis", "insects", "Coleoptera", "Lampyridae", "Photinus"),
    ("leafcutter-ant", "Leafcutter ant", "Atta cephalotes", "insects", "Hymenoptera", "Formicidae", "Atta"),
    ("emperor-scorpion", "Emperor scorpion", "Pandinus imperator", "arachnids", "Scorpiones", "Scorpionidae", "Pandinus"),
    ("goliath-birdeater", "Goliath birdeater", "Theraphosa blondi", "arachnids", "Araneae", "Theraphosidae", "Theraphosa"),
    ("bold-jumper", "Bold jumping spider", "Phidippus audax", "arachnids", "Araneae", "Salticidae", "Phidippus"),
    ("cuttlefish", "Common cuttlefish", "Sepia officinalis", "molluscs", "Sepiida", "Sepiidae", "Sepia", "Cephalopoda", "Mollusca"),
    ("blue-ringed-octopus", "Greater blue-ringed octopus", "Hapalochlaena lunulata", "molluscs", "Octopoda", "Octopodidae", "Hapalochlaena", "Cephalopoda", "Mollusca"),
    ("giant-clam", "Giant clam", "Tridacna gigas", "molluscs", "Cardiida", "Cardiidae", "Tridacna", "Bivalvia", "Mollusca"),
    ("banana-slug", "Pacific banana slug", "Ariolimax columbianus", "molluscs", "Stylommatophora", "Ariolimacidae", "Ariolimax", "Gastropoda", "Mollusca"),
    ("portuguese-man-o-war", "Portuguese man o' war", "Physalia physalis", "cnidarians", "Siphonophorae", "Physaliidae", "Physalia", "Hydrozoa", "Cnidaria"),
    ("magnificent-sea-anemone", "Magnificent sea anemone", "Heteractis magnifica", "cnidarians", "Actiniaria", "Stichodactylidae", "Heteractis", "Anthozoa", "Cnidaria"),
    ("purple-sea-urchin", "Purple sea urchin", "Strongylocentrotus purpuratus", "echinoderms", "Camarodonta", "Strongylocentrotidae", "Strongylocentrotus", "Echinoidea", "Echinodermata"),
    ("chocolate-chip-starfish", "Chocolate chip sea star", "Protoreaster nodosus", "echinoderms", "Valvatida", "Oreasteridae", "Protoreaster", "Asteroidea", "Echinodermata"),
]


def row_to_creature(row: tuple) -> dict | None:
    if not row or not row[0] or row[0] == "cheetah-already" or not row[1]:
        return None
    extra = list(row) + [None, None]
    cid, common, sci, class_id, order, family, genus = extra[:7]
    class_ov, phylum_ov = extra[7], extra[8]
    phylum, clazz = CLASS[class_id]
    if class_ov:
        clazz = class_ov
    if phylum_ov:
        phylum = phylum_ov
    genus = genus or sci.split()[0]
    return {
        "id": cid,
        "common": common,
        "scientific": sci,
        "wiki": sci,
        "classId": class_id,
        "domain": "Eukarya",
        "kingdom": "Animalia",
        "phylum": phylum,
        "class": clazz,
        "order": order,
        "family": family,
        "genus": genus,
        "species": sci,
    }


def main() -> None:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    existing = {c.get("id") for c in data.get("creatures") or []}
    existing |= {str(c.get("scientific") or "").lower() for c in data.get("creatures") or []}
    added = []
    for raw in ROWS:
        item = row_to_creature(raw)
        if not item:
            continue
        if item["id"] in existing or item["scientific"].lower() in existing:
            continue
        added.append(item)
        existing.add(item["id"])
        existing.add(item["scientific"].lower())
    # Keep plants after animals: insert new animals before first Plantae
    creatures = list(data.get("creatures") or [])
    idx = next((i for i, c in enumerate(creatures) if c.get("kingdom") == "Plantae"), len(creatures))
    creatures[idx:idx] = added
    data["creatures"] = creatures
    CATALOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    animals = sum(1 for c in creatures if c.get("kingdom") != "Plantae")
    plants = sum(1 for c in creatures if c.get("kingdom") == "Plantae")
    print(f"added {len(added)} animals; catalog now {animals} animals, {plants} plants")


if __name__ == "__main__":
    main()
