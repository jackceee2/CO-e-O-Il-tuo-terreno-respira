// Variabili globali per la mappa
let mainMap = null; // L'unica istanza principale della mappa
let mainDrawnItems = new L.FeatureGroup(); // Gruppo di feature per tutti i layer su mainMap
let drawControl = null; // Istanza di L.Control.Draw

// Stili per i poligoni sulla mappa
const stilePoligono = {
    color: "#2e7d32",
    weight: 3,
    opacity: 1,
    fillColor: "#81c784",
    fillOpacity: 0.5
};

const selectedStilePoligono = { // Stile di evidenziazione per il terreno selezionato
    color: "#007bff", /* Blu primario */
    weight: 4,
    opacity: 1,
    fillColor: "#66b3ff", /* Blu più chiaro */
    fillOpacity: 0.7
};

// Array per memorizzare tutti gli oggetti terreno
let terreni = [];
// ID del terreno attualmente selezionato nella lista
let selectedTerrenoId = null;
// Per il marker della ricerca indirizzo
let markerIndirizzo = null;
// Grafico CO2
let co2Chart;

// --- Funzioni di Inizializzazione Mappa ---
function initializeMainMap() {
    if (mainMap) {
        mainMap.remove(); // Distrugge l'istanza della mappa esistente, se presente
    }
    mainMap = L.map('main-map-container').setView([42.5, 12.5], 6); // Inizializza la mappa nel suo contenitore
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data © OpenStreetMap contributors'
    }).addTo(mainMap); // Aggiunge il layer di OpenStreetMap

    mainDrawnItems = new L.FeatureGroup(); // Re-inizializza il FeatureGroup
    mainMap.addLayer(mainDrawnItems); // Aggiunge il FeatureGroup alla mappa

    drawControl = new L.Control.Draw({
        draw: {
            polygon: {
                allowIntersection: false, // Non consente ai poligoni di intersecarsi
                showArea: true, // Mostra l'area mentre si disegna
                shapeOptions: stilePoligono // Usa lo stile predefinito per i poligoni
            },
            polyline: false, // Disabilita disegno polilinee
            rectangle: false, // Disabilita disegno rettangoli
            circle: false, // Disabilita disegno cerchi
            marker: false, // Disabilita disegno marker
            circlemarker: false // Disabilita disegno circlemarker
        },
        edit: {featureGroup: mainDrawnItems} // Consente la modifica degli elementi disegnati nel FeatureGroup
    });
    mainMap.addControl(drawControl); // Aggiunge i controlli di disegno alla mappa

    // Collega gli eventi di disegno/modifica alla mappa principale
    mainMap.on(L.Draw.Event.CREATED, onMapPolygonCreated);
    mainMap.on(L.Draw.Event.EDITED, onMapLayerEdited);
    mainMap.on(L.Draw.Event.DELETED, onMapLayerDeleted);
}

// --- Funzioni Core ---
function calcolaArea(poligono) {
    // Calcola l'area geodetica di un poligono (in metri quadrati)
    const area = L.GeometryUtil.geodesicArea(poligono.getLatLngs()[0]);
    // Restituisce l'area in ettari, formattata a due cifre decimali
    return (area / 10000).toFixed(2);
}

function calcolaPerimetro(poligono) {
    let perimetro = 0;
    const latlngs = poligono.getLatLngs()[0];
    // Itera sui punti del poligono per calcolare la distanza tra ogni punto e il successivo
    for (let i = 0; i < latlngs.length; i++) {
        if (i === 0) continue;
        perimetro += latlngs[i].distanceTo(latlngs[i - 1]);
    }
    // Aggiunge la distanza tra l'ultimo punto e il primo per chiudere il poligono
    perimetro += latlngs[latlngs.length - 1].distanceTo(latlngs[0]);
    // Restituisce il perimetro in metri, formattato a due cifre decimali
    return perimetro.toFixed(2);
}

// Tassi di assorbimento di CO2 per specie (kg/anno per unità base)
const co2Rates = {
    quercia: 21,
    pino: 18,
    abete: 16,
    faggio: 16,
    default: 15 // Tasso predefinito per specie non elencate
};

// Stima l'assorbimento totale di CO2 basandosi su un array di specie e sull'area del terreno
function stimaCO2(speciesArray, area_ha) {
    let totalCo2 = 0;
    const defaultRate = co2Rates.default;

    speciesArray.forEach(s => {
        const specieKey = s.name.toLowerCase();
        const rate = co2Rates[specieKey] || defaultRate;

        // Estrae il valore numerico dalla stringa di quantità (es. "10" da "10 alberi")
        const valueMatch = s.quantity.match(/(\d+(\.\d+)?)/);
        const value = valueMatch ? parseFloat(valueMatch[1]) : 0;

        // Calcola il CO2 in base all'unità specificata
        if (s.quantity.toLowerCase().includes('alberi') || s.quantity.toLowerCase().includes('piante') || s.quantity.toLowerCase().includes('unità')) {
            totalCo2 += rate * value;
        } else if (s.quantity.toLowerCase().includes('m²')) {
            totalCo2 += rate * value * 0.01; // Assumendo 1 unità per 100 mq
        } else if (s.quantity.toLowerCase().includes('ha')) {
            totalCo2 += rate * value * 100; // Assumendo 100 unità per ettaro per stima
        } else if (s.quantity.trim() === '') {
            // Se la quantità è vuota, ma il nome della specie è presente, assumiamo che si applichi all'intera area del terreno
            totalCo2 += rate * area_ha * 100; // Assumendo 100 unità per ettaro
        } else {
            // Caso predefinito: se è fornito solo un numero, si assume che siano unità
            if (!isNaN(value)) {
                totalCo2 += rate * value;
            }
        }
    });
    return totalCo2.toFixed(2); // Restituisce il totale CO2 formattato
}

// --- Eventi di Disegno Mappa per la Mappa Principale ---
function onMapPolygonCreated(e) {
    if (!selectedTerrenoId) {
        // Usa una modale personalizzata invece di alert()
        showCustomAlert("Seleziona o aggiungi un terreno dalla lista 'I miei terreni' prima di disegnare sulla mappa.");
        mainDrawnItems.removeLayer(e.layer);
        return;
    }

    const selectedTerreno = terreni.find(t => t.id === selectedTerrenoId);
    if (selectedTerreno) {
        if (selectedTerreno.leafletLayer) {
            mainDrawnItems.removeLayer(selectedTerreno.leafletLayer);
        }
        selectedTerreno.leafletLayer = e.layer;
        selectedTerreno.leafletLayer.setStyle(selectedStilePoligono);
        mainDrawnItems.addLayer(selectedTerreno.leafletLayer);

        // Salva le coordinate in un formato semplice (array di oggetti {lat, lng})
        selectedTerreno.coordinate = selectedTerreno.leafletLayer.getLatLngs()[0].map(latlng => ({
            lat: latlng.lat,
            lng: latlng.lng
        }));
        
        selectedTerreno.area_ha = parseFloat(calcolaArea(selectedTerreno.leafletLayer));
        selectedTerreno.perimetro_m = parseFloat(calcolaPerimetro(selectedTerreno.leafletLayer));

        document.getElementById("area").value = `${selectedTerreno.area_ha} ha`;
        document.getElementById("perimetro").value = `${selectedTerreno.perimetro_m} m`;

        selectedTerreno.leafletLayer.bindPopup(`Area: ${selectedTerreno.area_ha} ha<br>Perimetro: ${selectedTerreno.perimetro_m} m`).openPopup();

        // Usa una modale personalizzata invece di alert()
        showCustomAlert(`Poligono disegnato per "${selectedTerreno.name}". Clicca 'Salva dati terreno' per aggiornare.`);

        // Mostra le sezioni indirizzo, centroide e vertici (solo centroide e vertici rimangono)
        document.getElementById('coordinates-section').style.display = 'flex';
        document.getElementById('polygon-vertices-section').style.display = 'block'; // Mostra la nuova sezione
        
        // Aggiorna indirizzo, centroide e vertici
        updateAddressAndCoordinates();
        displayPolygonVertices(selectedTerreno.coordinate); // Chiama la nuova funzione
        updateDashboard(); // Aggiorna la dashboard dopo la creazione del poligono
    }
}

function onMapLayerEdited(e) {
    e.layers.eachLayer(layer => {
        const terreno = terreni.find(t => t.leafletLayer && L.Util.stamp(t.leafletLayer) === L.Util.stamp(layer));
        if (terreno) {
            // Aggiorna le coordinate in un formato semplice (array di oggetti {lat, lng})
            terreno.coordinate = layer.getLatLngs()[0].map(latlng => ({
                lat: latlng.lat,
                lng: latlng.lng
            }));

            terreno.area_ha = parseFloat(calcolaArea(layer));
            terreno.perimetro_m = parseFloat(calcolaPerimetro(layer));

            if (selectedTerrenoId === terreno.id) {
                document.getElementById("area").value = `${terreno.area_ha} ha`;
                document.getElementById("perimetro").value = `${terreno.perimetro_m} m`;
            }

            layer.bindPopup(`Area: ${terreno.area_ha} ha<br>Perimetro: ${terreno.perimetro_m} m`).openPopup();
            // Usa una modale personalizzata invece di alert()
            showCustomAlert(`Poligono per "${terreno.name}" modificato. Clicca 'Salva dati terreno' per aggiornare.`);

            // Aggiorna indirizzo, centroide e vertici dopo la modifica
            updateAddressAndCoordinates();
            displayPolygonVertices(terreno.coordinate); // Chiama la nuova funzione
            updateDashboard(); // Aggiorna la dashboard dopo la modifica del poligono
        }
    });
}

function onMapLayerDeleted(e) {
    e.layers.eachLayer(layer => {
        const terreno = terreni.find(t => t.leafletLayer && L.Util.stamp(t.leafletLayer) === L.Util.stamp(layer));
        if (terreno) {
            terreno.leafletLayer = null;
            terreno.coordinate = []; // Pulisci le coordinate
            terreno.area_ha = 0;
            terreno.perimetro_m = 0;

            if (selectedTerrenoId === terreno.id) {
                document.getElementById("area").value = "Disegna sulla mappa";
                document.getElementById("perimetro").value = "Disegna sulla mappa";
            }
            // Usa una modale personalizzata invece di alert()
            showCustomAlert(`Poligono per "${terreno.name}" eliminato. Clicca 'Salva dati terreno' per aggiornare.`);

            // Pulisce le informazioni di indirizzo, centroide e vertici
            document.getElementById("centroid-display").textContent = "Centroide: N/A";
            document.getElementById("vertices-display").innerHTML = "Nessun poligono selezionato o disegnato."; // Pulisci i vertici
            document.getElementById('polygon-vertices-section').style.display = 'none'; // Nascondi la sezione
            updateDashboard(); // Aggiorna la dashboard dopo l'eliminazione del poligono
        }
    });
}

// Nuova funzione per visualizzare le coordinate dei vertici
function displayPolygonVertices(coordinates) {
    const verticesDisplay = document.getElementById('vertices-display');
    verticesDisplay.innerHTML = ''; // Pulisci il contenuto precedente

    if (!coordinates || coordinates.length === 0) {
        verticesDisplay.innerHTML = 'Nessun poligono selezionato o disegnato.';
        return;
    }

    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.maxHeight = '200px'; // Limita l'altezza
    ul.style.overflowY = 'auto'; // Aggiungi scroll se necessario

    coordinates.forEach((coord, index) => {
        const li = document.createElement('li');
        li.textContent = `Vertice ${index + 1}: Latitudine ${coord.lat.toFixed(6)}, Longitudine ${coord.lng.toFixed(6)}`;
        li.style.marginBottom = '5px';
        ul.appendChild(li);
    });
    verticesDisplay.appendChild(ul);
}


// --- Sidebar Terrain Management Functions ---
function renderTerreniList() {
    const terrenoListUl = document.getElementById('terreno-list');
    terrenoListUl.innerHTML = '';

    if (terreni.length === 0) {
        terrenoListUl.innerHTML = '<li style="text-align: center; color: var(--text-color); opacity: 0.7;">Nessun terreno aggiunto.</li>';
        document.getElementById('selected-terrain-details').style.display = 'none';
        document.getElementById('coordinates-section').style.display = 'none';
        document.getElementById('polygon-vertices-section').style.display = 'none'; // Nascondi la sezione vertici
        mainDrawnItems.clearLayers();
        return;
    }

    terreni.forEach(t => {
        const li = document.createElement('li');
        li.id = `terreno-item-${t.id}`;
        li.classList.add('terreno-item');
        if (t.id === selectedTerrenoId) {
            li.classList.add('selected');
        }

        const terrainNameSpan = document.createElement('span');
        terrainNameSpan.classList.add('terreno-name');
        terrainNameSpan.textContent = t.name;
        // Rimosso il dblclick per l'edit, ora c'è un pulsante dedicato
        // terrainNameSpan.ondblclick = (e) => { e.stopPropagation(); editTerrenoName(t.id); };

        const actionsDiv = document.createElement('div');
        actionsDiv.classList.add('terreno-actions');

        // Pulsante Modifica Nome (spostato qui)
        const editButton = document.createElement('button');
        editButton.innerHTML = '<i class="fas fa-edit"></i>';
        editButton.title = 'Modifica Nome';
        editButton.onclick = (e) => {
            e.stopPropagation();
            editTerrenoName(t.id);
        };
        actionsDiv.appendChild(editButton);

        const deleteButton = document.createElement('button');
        deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
        deleteButton.title = 'Elimina Terreno';
        deleteButton.onclick = (e) => {
            e.stopPropagation();
            deleteTerreno(t.id);
        };

        actionsDiv.appendChild(deleteButton);
        li.appendChild(terrainNameSpan);
        li.appendChild(actionsDiv);

        li.onclick = () => selectTerreno(t.id);

        terrenoListUl.appendChild(li);
    });
    // Assicurati che le sezioni siano visibili una volta che ci sono terreni
    document.getElementById('selected-terrain-details').style.display = 'flex';
    document.getElementById('coordinates-section').style.display = 'flex';
    // Mostra la sezione vertici se c'è un terreno selezionato con un poligono
    const selectedTerreno = terreni.find(t => t.id === selectedTerrenoId);
    if (selectedTerreno && selectedTerreno.leafletLayer) {
        document.getElementById('polygon-vertices-section').style.display = 'block';
    } else {
        document.getElementById('polygon-vertices-section').style.display = 'none';
    }
}

function addTerreno() {
    const input = document.getElementById('terreno-name-input');
    let newName = input.value.trim();

    if (!newName) {
        // Usa una modale personalizzata invece di alert()
        showCustomAlert('Inserisci un nome per il nuovo terreno.');
        return;
    }

    let counter = 1;
    let originalName = newName;
    while (terreni.some(t => t.name === newName)) {
        newName = `${originalName} (${counter})`;
        counter++;
    }

    const newTerreno = {
        id: Date.now(),
        name: newName,
        species: [],
        area_ha: 0,
        perimetro_m: 0,
        co2_kg_annuo: 0,
        coordinate: [], // Inizializza come array vuoto
        leafletLayer: null
    };

    terreni.push(newTerreno);
    input.value = `Nuovo Terreno`;
    renderTerreniList();
    selectTerreno(newTerreno.id);
    // Pulisci il marker dell'indirizzo quando viene aggiunto un nuovo terreno
    clearAddressMarker(); // Solo il marker, non l'input
    // Usa una modale personalizzata invece di alert()
    showCustomAlert(`Terreno "${newName}" aggiunto. Ora puoi disegnarlo sulla mappa e aggiungere le specie.`);
}

function selectTerreno(id) {
    // Se c'era un terreno precedentemente selezionato, deselezionarlo e ripristinare lo stile predefinito del poligono
    if (selectedTerrenoId) {
        const prevSelectedTerreno = terreni.find(t => t.id === selectedTerrenoId);
        if (prevSelectedTerreno && prevSelectedTerreno.leafletLayer) {
            prevSelectedTerreno.leafletLayer.setStyle(stilePoligono);
        }
        const prevSelectedLi = document.getElementById(`terreno-item-${selectedTerrenoId}`);
        if (prevSelectedLi) {
            prevSelectedLi.classList.remove('selected');
        }
    }

    // Imposta il nuovo terreno selezionato
    selectedTerrenoId = id;

    // Aggiungi la classe 'selected' all'elemento della lista del nuovo terreno
    const newSelectedLi = document.getElementById(`terreno-item-${selectedTerrenoId}`);
    if (newSelectedLi) {
        newSelectedLi.classList.add('selected');
    }

    // Pulisci qualsiasi marker di indirizzo esistente quando viene selezionato un nuovo terreno
    clearAddressMarker(); // Solo il marker, non l'input

    // Aggiorna i dettagli del terreno nel pannello principale
    const terreno = terreni.find(t => t.id === id);
    if (terreno) {
        document.getElementById("current-terrain-name").textContent = terreno.name;
        document.getElementById("area").value = terreno.area_ha > 0 ? `${terreno.area_ha} ha` : 'Disegna sulla mappa';
        document.getElementById("perimetro").value = terreno.perimetro_m > 0 ? `${terreno.perimetro_m} m` : 'Disegna sulla mappa';
        document.getElementById("quantita").value = terreno.quantita || '';

        renderSpeciesListForSelectedTerrain();
        document.getElementById("new-species-name-input").value = "";
        document.getElementById("new-species-quantity-input").value = "";

        // Visualizza le sezioni indirizzo, coordinate e vertici se un terreno è selezionato
        document.getElementById('selected-terrain-details').style.display = 'flex';
        document.getElementById('coordinates-section').style.display = 'flex';
        
        if (terreno.leafletLayer) {
            terreno.leafletLayer.setStyle(selectedStilePoligono);
            mainMap.fitBounds(terreno.leafletLayer.getBounds(), { padding: [20, 20], maxZoom: 16 });
            updateAddressAndCoordinates(); // Aggiorna indirizzo e centroide
            displayPolygonVertices(terreno.coordinate); // Mostra i vertici
            document.getElementById('polygon-vertices-section').style.display = 'block'; // Mostra la sezione
        } else {
            // Se non c'è un poligono disegnato per il terreno selezionato, pulisci le info
            document.getElementById("centroid-display").textContent = "Centroide: N/A";
            document.getElementById("vertices-display").innerHTML = "Nessun poligono selezionato o disegnato."; // Pulisci i vertici
            document.getElementById('polygon-vertices-section').style.display = 'none'; // Nascondi la sezione
            // Rimosso: mainMap.setView([42.5, 12.5], 6); // Non resettare la vista della mappa
        }
        mainMap.invalidateSize();
        // Aggiorna la dashboard per riflettere l'area del terreno selezionato
        updateDashboard();
    }
}

function editTerrenoName(id) {
    const terreno = terreni.find(t => t.id === id);
    if (!terreno) return;

    // Usa una modale personalizzata per il prompt
    showCustomPrompt(`Modifica nome per "${terreno.name}":`, terreno.name, (newName) => {
        if (newName !== null && newName.trim() !== '' && newName.trim() !== terreno.name) {
            terreno.name = newName.trim();
            renderTerreniList();
            if (selectedTerrenoId === id) {
                document.getElementById("current-terrain-name").textContent = terreno.name;
            }
            updateTerreniTable();
            updateAllLayerPopups();
        }
    });
}

function deleteTerreno(id) {
    // Usa una modale personalizzata per la conferma
    showCustomConfirm('Sei sicuro di voler eliminare questo terreno?', (confirmed) => {
        if (!confirmed) {
            return;
        }

        const index = terreni.findIndex(t => t.id === id);
        if (index > -1) {
            const terrainToDelete = terreni[index];
            if (terrainToDelete.leafletLayer) {
                mainDrawnItems.removeLayer(terrainToDelete.leafletLayer); // Rimuove il poligono dalla mappa
            }
            terreni.splice(index, 1); // Rimuove il terreno dall'array

            // Gestione della selezione dopo l'eliminazione
            if (selectedTerrenoId === id) {
                selectedTerrenoId = null; // Nessun terreno selezionato
                if (terreni.length > 0) {
                    selectTerreno(terreni[0].id); // Seleziona il primo terreno se esiste
                } else {
                    // Nasconde e pulisce le sezioni se non ci sono più terreni
                    document.getElementById('selected-terrain-details').style.display = 'none';
                    document.getElementById('coordinates-section').style.display = 'none';
                    document.getElementById('polygon-vertices-section').style.display = 'none'; // Nascondi la sezione vertici
                    document.getElementById("current-terrain-name").textContent = "";
                    document.getElementById("area").value = "Disegna sulla mappa";
                    document.getElementById("perimetro").value = "Disegna sulla mappa";
                    document.getElementById("vertices-display").innerHTML = "Nessun poligono selezionato o disegnato."; // Pulisci i vertici
                    renderSpeciesListForSelectedTerrain();
                    mainDrawnItems.clearLayers(); // Pulisce la mappa
                }
            }
            renderTerreniList(); // Aggiorna la lista nella sidebar
            updateDashboard(); // Aggiorna i totali e i grafici/tabelle

            // Se non ci sono più terreni o il terreno selezionato è stato eliminato, pulisci il marker dell'indirizzo
            if (terreni.length === 0 || selectedTerrenoId === null) {
                clearAddressMarkerAndInput(); // Pulisci sia il marker che l'input
            }
        }
    });
}

// --- Funzioni di Gestione Specie ---
function renderSpeciesListForSelectedTerrain() {
    const speciesListUl = document.getElementById('species-list-for-selected-terrain');
    speciesListUl.innerHTML = '';
    const selectedTerreno = terreni.find(t => t.id === selectedTerrenoId);

    if (!selectedTerreno || selectedTerreno.species.length === 0) {
        speciesListUl.innerHTML = '<li style="text-align: center; color: var(--text-color); opacity: 0.7;">Nessuna specie aggiunta.</li>';
        return;
    }

    selectedTerreno.species.forEach((s, index) => {
        const li = document.createElement('li');
        li.classList.add('species-item');
        li.innerHTML = `
            <span>${s.name} (${s.quantity})</span>
            <div class="species-item-actions">
                <button onclick="editSpeciesInSelectedTerrain(${index})"><i class="fas fa-edit"></i></button>
                <button onclick="deleteSpeciesFromSelectedTerrain(${index})"><i class="fas fa-trash"></i></button>
            </div>
        `;
        speciesListUl.appendChild(li);
    });
}

function addSpeciesToSelectedTerrain() {
    const newSpeciesNameInput = document.getElementById('new-species-name-input');
    const newSpeciesQuantityInput = document.getElementById('new-species-quantity-input');

    const name = newSpeciesNameInput.value.trim();
    const quantity = newSpeciesQuantityInput.value.trim();

    if (!name) {
        // Usa una modale personalizzata invece di alert()
        showCustomAlert("Inserisci il nome della specie.");
        return;
    }

    if (!selectedTerrenoId) {
        // Usa una modale personalizzata invece di alert()
        showCustomAlert("Seleziona un terreno prima di aggiungere specie.");
        return;
    }

    const selectedTerreno = terreni.find(t => t.id === selectedTerrenoId);
    if (selectedTerreno) {
        selectedTerreno.species.push({ name, quantity });
        newSpeciesNameInput.value = '';
        newSpeciesQuantityInput.value = '';
        renderSpeciesListForSelectedTerrain();
        // Usa una modale personalizzata invece di alert()
        showCustomAlert(`Specie "${name}" aggiunta al terreno "${selectedTerreno.name}". Ricorda di cliccare 'Salva dati terreno' per salvare le modifiche.`);
    }
}

function editSpeciesInSelectedTerrain(index) {
    const selectedTerreno = terreni.find(t => t.id === selectedTerrenoId);
    if (!selectedTerreno || !selectedTerreno.species[index]) return;

    const currentSpecies = selectedTerreno.species[index];
    
    // Usa una modale personalizzata per il prompt
    showCustomPrompt(`Modifica nome specie per "${selectedTerreno.name}":`, currentSpecies.name, (newName) => {
        if (newName === null) return; // L'utente ha annullato

        showCustomPrompt(`Modifica quantità/densità per "${newName}":`, currentSpecies.quantity, (newQuantity) => {
            if (newQuantity === null) return; // L'utente ha annullato

            if (newName.trim() !== '') {
                selectedTerreno.species[index] = { name: newName.trim(), quantity: newQuantity.trim() };
                renderSpeciesListForSelectedTerrain();
                // Usa una modale personalizzata invece di alert()
                showCustomAlert(`Specie modificata per "${selectedTerreno.name}". Ricorda di cliccare 'Salva dati terreno'.`);
            } else {
                // Usa una modale personalizzata invece di alert()
                showCustomAlert("Il nome della specie non può essere vuoto.");
            }
        });
    });
}

function deleteSpeciesFromSelectedTerrain(index) {
    // Usa una modale personalizzata per la conferma
    showCustomConfirm('Sei sicuro di voler eliminare questa specie?', (confirmed) => {
        if (!confirmed) return;

        const selectedTerreno = terreni.find(t => t.id === selectedTerrenoId);
        if (selectedTerreno && selectedTerreno.species[index]) {
            selectedTerreno.species.splice(index, 1);
            renderSpeciesListForSelectedTerrain();
            // Usa una modale personalizzata invece di alert()
            showCustomAlert(`Specie eliminata dal terreno "${selectedTerreno.name}". Ricorda di cliccare 'Salva dati terreno'.`);
        }
    });
}

// --- Funzione Salva Dati (modificata per specie multiple) ---
async function saveData() {
    if (!selectedTerrenoId) {
        showCustomAlert("Nessun terreno selezionato per il salvataggio dei dati. Aggiungi o seleziona un terreno.");
        return;
    }

    const terreno = terreni.find(t => t.id === selectedTerrenoId);
    if (!terreno) {
        showCustomAlert("Errore: Terreno selezionato non trovato.");
        return;
    }

    const areaVal = document.getElementById("area").value.replace(' ha', '');
    const perimetroVal = document.getElementById("perimetro").value.replace(' m', '');

    terreno.area_ha = parseFloat(areaVal) || 0;
    terreno.perimetro_m = parseFloat(perimetroVal) || 0;
    terreno.quantita = document.getElementById("quantita").value.trim();

    terreno.co2_kg_annuo = stimaCO2(terreno.species, terreno.area_ha);

    if (terreno.leafletLayer) {
        const popupContent = `<strong>Nome:</strong> ${terreno.name}<br>` +
                             `<strong>Specie:</strong> ${terreno.species.map(s => `${s.name} (${s.quantity})`).join(', ') || 'N/A'}<br>` +
                             `<strong>Area:</strong> ${terreno.area_ha} ha<br>` +
                             `<strong>Perimetro:</strong> ${terreno.perimetro_m} m<br>` +
                             `<strong>Stima CO₂:</strong> ${terreno.co2_kg_annuo} kg/anno`;
        terreno.leafletLayer.bindPopup(popupContent);
    }

    updateDashboard();
    showCustomAlert(`Dati per "${terreno.name}" salvati!`);

    // --- Integrazione Backend: Invia i dati al server ---
    // URL CORRETTO del tuo server backend Flask
    const backendUrl = 'http://localhost:3001/save-coordinates';

    // Recupera le coordinate del centroide e dei vertici per il terreno selezionato
    let centroidCoords = null;
    const centroidDisplay = document.getElementById("centroid-display").textContent;
    const centroidMatch = centroidDisplay.match(/Lat ([\d.]+), Lon ([\d.]+)/);
    if (centroidMatch) {
        centroidCoords = {
            lat: parseFloat(centroidMatch[1]),
            lng: parseFloat(centroidMatch[2])
        };
    }
    
    // Le coordinate dei vertici sono già nell'oggetto terreno.coordinate
    const polygonVertices = terreno.coordinate;

    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                // Invia solo le coordinate del centroide e dei vertici
                centroid: centroidCoords,
                vertices: polygonVertices
                // Puoi aggiungere altri dati del terreno qui se il tuo backend li gestisce
                // name: terreno.name,
                // area_ha: terreno.area_ha,
                // ...
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Errore salvataggio dati backend: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('Dati inviati al backend con successo:', result);
        showCustomAlert('Dati terreno inviati al backend con successo!');

    } catch (error) {
        console.error('Errore durante l\'invio dei dati al backend:', error);
        showCustomAlert('Errore durante il salvataggio dei dati nel backend. Controlla la console per i dettagli.');
    }
}

// Funzione helper per pulire solo il marker dell'indirizzo
function clearAddressMarker() {
    if (markerIndirizzo) {
        mainMap.removeLayer(markerIndirizzo);
        markerIndirizzo = null;
    }
}

// Nuova funzione per pulire il marker E il campo di input
function clearAddressMarkerAndInput() {
    clearAddressMarker(); // Pulisci il marker
    document.getElementById('indirizzo_search_sidebar').value = ''; // Pulisci il campo di input
}

// --- Funzione di Ricerca Indirizzo (Aggiornata per la sidebar) ---
function goToLocationSidebar() {
    const indirizzo = document.getElementById("indirizzo_search_sidebar").value.trim();
    if (!indirizzo) {
        showCustomAlert("Inserisci un indirizzo valido.");
        return;
    }

    clearAddressMarker(); // Pulisci il marker esistente prima di una nuova ricerca (ma non l'input)

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(indirizzo)}`)
        .then(response => response.json())
        .then(data => {
            if (data.length === 0) {
                showCustomAlert("Indirizzo non trovato.");
                return;
            }
            const lat = data[0].lat;
            const lon = data[0].lon;

            mainMap.setView([lat, lon], 16);

            markerIndirizzo = L.marker([lat, lon]).addTo(mainMap)
                .bindPopup("Indirizzo trovato: " + indirizzo)
                .openPopup();
        })
        .catch(error => {
            showCustomAlert("Errore nella ricerca dell'indirizzo.");
            console.error(error);
            // In caso di errore, assicurati che il marker sia comunque pulito
            clearAddressMarker();
        });
}

// --- Funzioni per Indirizzo Approssimativo e Coordinate Centroide ---
/**
 * Calcola e visualizza le coordinate del centroide per il poligono fornito.
 * Aggiorna il paragrafo con id="centroid-display".
 * @param {L.Polygon} polygonLayer - Il layer del poligono Leaflet.
 */
function calculateAndDisplayCentroid(polygonLayer) {
    // Step 1: Controllo robusto sulla disponibilità di Turf.js e validità del layer
    if (typeof turf === 'undefined') {
        console.error("Errore calculateAndDisplayCentroid: La libreria Turf.js non è caricata. Assicurati che <script src='https://unpkg.com/@turf/turf@6/turf.min.js'> sia accessibile e caricato.");
        document.getElementById("centroid-display").textContent = "Centroide: Errore (Turf.js non caricato).";
        return;
    }

    if (!polygonLayer || !polygonLayer.getLatLngs) {
        console.warn("calculateAndDisplayCentroid: Nessun layer poligono valido fornito.");
        document.getElementById("centroid-display").textContent = "Centroide: N/A";
        return;
    }

    const latlngsOuterRing = polygonLayer.getLatLngs()[0]; // Ottiene l'array di LatLng per il contorno esterno del poligono

    // Step 2: Validazione delle coordinate. Assicurati che l'array di punti sia sufficiente per un poligono.
    // Un poligono valido per Turf.js richiede almeno 3 punti distinti, più il punto di chiusura (totale 4 punti).
    if (!Array.isArray(latlngsOuterRing) || latlngsOuterRing.length < 3) {
         console.warn("calculateAndDisplayCentroid: Coordinate del poligono insufficienti (minimo 3 punti distinti necessari per una forma).");
         document.getElementById("centroid-display").textContent = "Centroide: N/A (poligono non valido).";
         return;
    }

    // Step 3: Converte gli oggetti LatLng di Leaflet nel formato [longitudine, latitudine] richiesto da Turf.js
    // E CHIUDE IL POLIGONO se non è già chiuso (molto importante per Turf.js)
    let geoJsonCoords = latlngsOuterRing.map(l => [l.lng, l.lat]);

    // Assicurati che il poligono sia chiuso. Il primo e l'ultimo punto devono essere identici.
    // Leaflet.draw chiude automaticamente il poligono visivamente, ma l'array di LatLngs potrebbe non ripetersi l'ultimo punto.
    if (!latlngsOuterRing[0].equals(latlngsOuterRing[latlngsOuterRing.length - 1])) {
        geoJsonCoords.push(geoJsonCoords[0]); // Aggiunge il primo punto alla fine per chiudere il poligono
    }

    // Dopo la potenziale chiusura, verifica che ci siano almeno 4 punti per un poligono valido per Turf.js
    if (geoJsonCoords.length < 4) {
        console.warn("calculateAndDisplayCentroid: Poligono non valido anche dopo il tentativo di chiusura. Richiede almeno 4 punti (3 distinti + chiusura).");
        document.getElementById("centroid-display").textContent = "Centroide: N/A (poligono troppo piccolo).";
        return;
    }

    try {
        // Step 4: Crea un oggetto GeoJSON di tipo Polygon da passare a Turf.js
        // turf.polygon() si aspetta un array di anelli, dove il primo anello è il contorno esterno.
        const turfPolygon = turf.polygon([geoJsonCoords]);

        // Step 5: Calcola il centroide
        const centroid = turf.centroid(turfPolygon);
        const centroidCoords = centroid.geometry.coordinates; // [longitudine, latitudine]

        // Step 6: Estrai e formatta le coordinate del centroide
        const centroidLat = centroidCoords[1].toFixed(6); // Latitudine
        const centroidLon = centroidCoords[0].toFixed(6); // Longitudine

        // Step 7: Aggiorna la UI
        document.getElementById("centroid-display").textContent = `Centroide: Lat ${centroidLat}, Lon ${centroidLon}`;
    } catch (error) {
        // Step 8: Gestione degli errori più specifica
        console.error("calculateAndDisplayCentroid: Errore critico nel calcolo del centroide con Turf.js. Controllare la validità del poligono disegnato e il formato delle coordinate:", error);
        document.getElementById("centroid-display").textContent = "Centroide: Errore nel calcolo (vedi console).";
    }
}

/**
 * Aggiorna l'indirizzo approssimativo e delega il calcolo del centroide.
 * Questa funzione viene chiamata quando un terreno è selezionato, disegnato o modificato.
 */
function updateAddressAndCoordinates() {
    const terreno = terreni.find(t => t.id === selectedTerrenoId);

    // Assicurati che un terreno sia selezionato e che abbia un layer Leaflet associato
    if (terreno && terreno.leafletLayer) {
        const polygon = terreno.leafletLayer;

        // Chiama la funzione dedicata per calcolare e visualizzare il centroide.
        // Questa funzione contiene già la logica di validazione e visualizzazione.
        calculateAndDisplayCentroid(polygon);

        // Procedi con la geocodifica inversa per l'indirizzo approssimativo.
        // Ricalcoliamo il centroide per la geocodifica inversa con gli stessi controlli di validazione.
        if (typeof turf !== 'undefined' && polygon.getLatLngs().length > 0 && polygon.getLatLngs()[0].length >= 3) {
            const latlngsForAddress = polygon.getLatLngs()[0];
            let geoJsonCoordsForAddress = latlngsForAddress.map(l => [l.lng, l.lat]);

            // Assicurati che il poligono sia chiuso anche per la geocodifica inversa
            if (!latlngsForAddress[0].equals(latlngsForAddress[latlngsForAddress.length - 1])) {
                geoJsonCoordsForAddress.push(geoJsonCoordsForAddress[0]);
            }

            if (geoJsonCoordsForAddress.length >= 4) { // Deve avere almeno 4 punti dopo la chiusura
                try {
                    const turfPolygonForAddress = turf.polygon([geoJsonCoordsForAddress]);
                    const centroidForAddress = turf.centroid(turfPolygonForAddress);
                    const centroidCoordsForAddress = centroidForAddress.geometry.coordinates;

                    reverseGeocode(centroidCoordsForAddress[1], centroidCoordsForAddress[0])
                        .then(address => {
                            // document.getElementById("address-display").textContent = address; // Rimosso
                        })
                        .catch(error => {
                            // document.getElementById("address-display").textContent = "Indirizzo non trovato."; // Rimosso
                            console.error("Errore di geocodifica inversa:", error);
                        });
                } catch (e) {
                    console.error("Errore nel calcolo del centroide per la geocodifica indirizzo:", e);
                    // document.getElementById("address-display").textContent = "Nessun indirizzo trovato (errore calcolo centroide per indirizzo)."; // Rimosso
                }
            } else {
                // document.getElementById("address-display").textContent = "Nessun indirizzo trovato (poligono troppo piccolo/non valido)."; // Rimosso
            }
        } else {
            console.warn("Turf.js non disponibile o poligono non valido per geocodifica inversa dell'indirizzo.");
            // document.getElementById("address-display").textContent = "Nessun indirizzo trovato."; // Rimosso
        }

    } else {
        // Se nessun terreno è selezionato o il terreno selezionato non ha un poligono disegnato
        document.getElementById("centroid-display").textContent = "Centroide: N/A";
    }
}

// Funzione per la geocodifica inversa (usa Nominatim di OpenStreetMap)
async function reverseGeocode(lat, lng) {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=it`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.display_name || "Indirizzo non trovato.";
}


// --- Utilità Mappa Globale ---
function updateAllMapLayers() {
    mainDrawnItems.clearLayers();

    terreni.forEach(t => {
        if (t.leafletLayer) {
            t.leafletLayer.setStyle(t.id === selectedTerrenoId ? selectedStilePoligono : stilePoligono);
            mainDrawnItems.addLayer(t.leafletLayer);

            const popupContent = `<strong>Nome:</strong> ${t.name}<br>` +
                                 `<strong>Specie:</strong> ${t.species.map(s => `${s.name} (${s.quantity})`).join(', ') || 'N/A'}<br>` +
                                 `<strong>Area:</strong> ${t.area_ha} ha<br>` +
                                 `<strong>Perimetro:</strong> ${t.perimetro_m} m<br>` +
                                 `<strong>Stima CO₂:</strong> ${t.co2_kg_annuo} kg/anno`;
            t.leafletLayer.bindPopup(popupContent);
        }
    });

    if (mainDrawnItems.getLayers().length > 0) {
        if (selectedTerrenoId && terreni.find(t => t.id === selectedTerrenoId && t.leafletLayer)) {
            mainMap.fitBounds(terreni.find(t => t.id === selectedTerrenoId).leafletLayer.getBounds(), { padding: [20, 20], maxZoom: 16 });
        } else {
            mainMap.fitBounds(mainDrawnItems.getBounds(), { padding: [20, 20] });
        }
    } else {
        // Rimosso: mainMap.setView([42.5, 12.5], 6); // Non resettare la vista della mappa
    }
}

function updateAllLayerPopups() {
    terreni.forEach(t => {
        if (t.leafletLayer) {
            const popupContent = `<strong>Nome:</strong> ${t.name}<br>` +
                                 `<strong>Specie:</strong> ${t.species.map(s => `${s.name} (${s.quantity})`).join(', ') || 'N/A'}<br>` +
                                 `<strong>Area:</strong> ${t.area_ha} ha<br>` +
                                 `<strong>CO₂:</strong> ${t.co2_kg_annuo} kg/anno`;
            t.leafletLayer.bindPopup(popupContent);
        }
    });
}

function esportaDati() {
    if (terreni.length === 0) {
        // Usa una modale personalizzata invece di alert()
        showCustomAlert("Nessun terreno salvato.");
        return;
    }

    const dati = terreni.map(t => ({
        nome: t.name,
        specie_dettagli: t.species,
        area_ha: t.area_ha,
        perimetro_m: t.perimetro_m,
        assorbimento_CO2_annuo_kg: t.co2_kg_annuo,
        // Esporta le coordinate nel formato {lat, lng}
        coordinate: t.coordinate || [] 
    }));

    const blob = new Blob([JSON.stringify(dati, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "terreni_CO2.json";
    a.click();
    URL.revokeObjectURL(url);
}

function applicaFiltro() {
    const filtro = document.getElementById("filtro-specie").value.trim().toLowerCase();
    if (!filtro) {
        // Usa una modale personalizzata invece di alert()
        showCustomAlert("Inserisci una specie per filtrare.");
        return;
    }

    mainDrawnItems.eachLayer(layer => {
        const terreno = terreni.find(t => t.leafletLayer && L.Util.stamp(t.leafletLayer) === L.Util.stamp(layer));
        if (terreno && terreno.species.some(s => s.name.toLowerCase().includes(filtro))) {
            layer.setStyle({fillOpacity: 0.5, opacity: 1});
        } else {
            layer.setStyle({fillOpacity: 0, opacity: 0});
        }
    });
}

function resetFiltro() {
    mainDrawnItems.eachLayer(layer => {
        layer.setStyle({fillOpacity: 0.5, opacity: 1});
    });
    document.getElementById("filtro-specie").value = "";
    if (selectedTerrenoId) {
        const selectedTerreno = terreni.find(t => t.id === selectedTerrenoId);
        if (selectedTerreno && selectedTerreno.leafletLayer) {
            selectedTerreno.leafletLayer.setStyle(selectedStilePoligono);
        }
    }
}

function updateDashboard() {
    // La riga successiva per totalTerreni può essere rimossa se hai già rimosso "Terreni Registrati" nell'HTML
    const totalTerreni = terreni.length;
    const totalCO2 = terreni.reduce((sum, t) => sum + parseFloat(t.co2_kg_annuo || 0), 0).toFixed(2);

    // Trova il terreno attualmente selezionato
    const selectedTerreno = terreni.find(t => t.id === selectedTerrenoId);

    // Se un terreno è selezionato, usa la sua area; altrimenti, l'area è 0.
    const areaForDisplay = selectedTerreno ? parseFloat(selectedTerreno.area_ha || 0).toFixed(2) : '0.00';

    // Se un terreno è selezionato, usa la sua CO2 assorbita; altrimenti, la CO2 è 0.
    const co2ForDisplay = selectedTerreno ? parseFloat(selectedTerreno.co2_kg_annuo || 0).toFixed(2) : '0.00';

    // Aggiorna la casella "Area Totale (ha)" con l'area del terreno selezionato
    document.getElementById("total-area").textContent = areaForDisplay;

    document.getElementById("total-co2").textContent = co2ForDisplay; // Lascia questa riga per CO2 totale

    updateTerreniTable();
    updateCO2Chart();
    updateAllMapLayers();
}

function updateTerreniTable() {
    const tableBody = document.querySelector("#terreni-table tbody");
    tableBody.innerHTML = '';

    terreni.forEach(t => {
        const row = tableBody.insertRow();
<<<<<<< HEAD
        // Aggiungi l'attributo data-label a ogni cella per la responsività
        const cell1 = row.insertCell();
        cell1.textContent = t.name;
        cell1.setAttribute('data-label', 'Nome Terreno');

        const cell2 = row.insertCell();
        cell2.textContent = t.species.map(s => `${s.name} (${s.quantity})`).join(', ') || 'N/A';
        cell2.setAttribute('data-label', 'Specie');

        const cell3 = row.insertCell();
        cell3.textContent = t.area_ha || '0.00';
        cell3.setAttribute('data-label', 'Area (ha)');
=======
        row.insertCell().textContent = t.name;
        row.insertCell().textContent = t.species.map(s => `${s.name} (${s.quantity})`).join(', ') || 'N/A';
        row.insertCell().textContent = t.area_ha || '0.00';
        row.insertCell().textContent = t.co2_kg_annuo || '0.00';
        const actionsCell = row.insertCell(); // <-- Creazione corretta della cella per i pulsanti
        actionsCell.classList.add('actions-cell'); ////
        
        const editButton = document.createElement('button');
        editButton.innerHTML = '<i class="fas fa-edit"></i>';
        editButton.title = 'Modifica Nome';
        editButton.onclick = (e) => {
            e.stopPropagation();
            editTerrenoName(t.id);
        };
        actionsCell.appendChild(editButton);
>>>>>>> 16b11b4eac7095159b938f7a08a44e3f984419c9

        const cell4 = row.insertCell();
        cell4.textContent = t.co2_kg_annuo || '0.00';
        cell4.setAttribute('data-label', 'CO₂ Assorbita (kg/anno)');
    });
}

function updateCO2Chart() {
    const speciesData = {};
    terreni.forEach(t => {
        t.species.forEach(s => {
            const specieName = s.name.toLowerCase();
            if (!specieName) return;

            if (!speciesData[specieName]) {
                speciesData[specieName] = 0;
            }

            const valueMatch = s.quantity.match(/(\d+(\.\d+)?)/);
            const value = valueMatch ? parseFloat(valueMatch[1]) : 0;
            const rate = co2Rates[specieName] || co2Rates.default;

            if (s.quantity.toLowerCase().includes('ha')) {
                speciesData[specieName] += rate * value * 100;
            } else if (s.quantity.toLowerCase().includes('m²')) {
                speciesData[specieName] += rate * value * 0.01;
            } else {
                speciesData[specieName] += rate * value;
            }
        });
    });

    const labels = Object.keys(speciesData);
    const data = Object.values(speciesData);

    if (co2Chart) {
        co2Chart.destroy();
    }

    const ctx = document.getElementById('co2Chart').getContext('2d');
    co2Chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'CO₂ Assorbita (kg/anno)',
                data: data,
                backgroundColor: [
                    'rgba(40, 167, 69, 0.7)',
                    'rgba(0, 123, 255, 0.7)',
                    'rgba(255, 193, 7, 0.7)',
                    'rgba(220, 53, 69, 0.7)',
                    'rgba(108, 117, 125, 0.7)'
                ],
                borderColor: [
                    'rgba(40, 167, 69, 1)',
                    'rgba(0, 123, 255, 1)',
                    'rgba(255, 193, 7, 1)',
                    'rgba(220, 53, 69, 1)',
                    'rgba(108, 117, 125, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'CO₂ Assorbita (kg/anno)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Specie Vegetale'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'Assorbimento di CO₂ per Specie'
                }
            }
        }
    });
}

// --- Logica Toggle Sidebar ---
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('hidden');
    setTimeout(() => {
        if (mainMap) mainMap.invalidateSize();
    }, 300);
}

// --- Funzione per utilizzare i dati catastali ---
function useCadastralData() {
    // Usa una modale personalizzata invece di alert()
    showCustomAlert("Funzione 'Utilizza dati catastali' ancora da implementare.");
    // Qui andrebbe la logica per integrare i dati catastali,
    // ad esempio, aprendo un popup o una nuova interfaccia per la ricerca.
}

// --- Funzioni per modali personalizzate (sostituzione di alert/confirm/prompt) ---
function createModal(type, message, defaultValue = '', callback = null) {
    // Rimuovi eventuali modali esistenti per evitare sovrapposizioni
    const existingModal = document.getElementById('custom-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'custom-modal';
    modalOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background-color: white;
        padding: 25px;
        border-radius: 10px;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        max-width: 400px;
        width: 90%;
        text-align: center;
        font-family: 'Roboto', sans-serif;
        color: var(--text-color);
        position: relative; /* Per il pulsante di chiusura */
    `;

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;'; // Simbolo 'x'
    closeButton.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 1.5em;
        cursor: pointer;
        color: #aaa;
        width: 30px; /* Rendi cliccabile più facilmente */
        height: 30px;
        padding: 0;
        line-height: 1; /* Allinea la 'x' al centro */
    `;
    closeButton.onclick = () => {
        document.body.removeChild(modalOverlay);
        if (callback && type === 'prompt') {
            callback(null); // Invia null se l'utente chiude il prompt
        }
    };
    modalContent.appendChild(closeButton);

    const messagePara = document.createElement('p');
    messagePara.textContent = message;
    messagePara.style.cssText = `
        margin-bottom: 20px;
        font-size: 1.1em;
        line-height: 1.4;
        padding-top: 10px; /* Spazio per la 'x' */
    `;
    modalContent.appendChild(messagePara);

    if (type === 'prompt') {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue;
        input.style.cssText = `
            width: calc(100% - 20px);
            padding: 10px;
            margin-bottom: 15px;
            border: 1px solid var(--border-color);
            border-radius: 5px;
            font-size: 1em;
        `;
        modalContent.appendChild(input);

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'OK';
        confirmBtn.style.cssText = `
            background-color: var(--primary-blue);
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 1em;
            margin-right: 10px;
            width: auto; /* Sovrascrivi il 100% */
        `;
        confirmBtn.onclick = () => {
            document.body.removeChild(modalOverlay);
            if (callback) callback(input.value);
        };
        modalContent.appendChild(confirmBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Annulla';
        cancelBtn.style.cssText = `
            background-color: #ccc;
            color: var(--text-color);
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 1em;
            width: auto; /* Sovrascrivi il 100% */
        `;
        cancelBtn.onclick = () => {
            document.body.removeChild(modalOverlay);
            if (callback) callback(null);
        };
        modalContent.appendChild(cancelBtn);

        input.focus(); // Metti il focus sull'input
    } else if (type === 'confirm') {
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Sì';
        confirmBtn.style.cssText = `
            background-color: var(--primary-green);
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 1em;
            margin-right: 10px;
            width: auto; /* Sovrascrivi il 100% */
        `;
        confirmBtn.onclick = () => {
            document.body.removeChild(modalOverlay);
            if (callback) callback(true);
        };
        modalContent.appendChild(confirmBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'No';
        cancelBtn.style.cssText = `
            background-color: #ccc;
            color: var(--text-color);
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 1em;
            width: auto; /* Sovrascrivi il 100% */
        `;
        cancelBtn.onclick = () => {
            document.body.removeChild(modalOverlay);
            if (callback) callback(false);
        };
        modalContent.appendChild(cancelBtn);
    } else { // type === 'alert'
        const okBtn = document.createElement('button');
        okBtn.textContent = 'OK';
        okBtn.style.cssText = `
            background-color: var(--primary-blue);
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 1em;
            width: auto; /* Sovrascrivi il 100% */
        `;
        okBtn.onclick = () => {
            document.body.removeChild(modalOverlay);
            if (callback) callback();
        };
        modalContent.appendChild(okBtn);
    }

    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);
}

function showCustomAlert(message, callback = null) {
    createModal('alert', message, '', callback);
}

function showCustomConfirm(message, callback) {
    createModal('confirm', message, '', callback);
}

function showCustomPrompt(message, defaultValue, callback) {
    createModal('prompt', message, defaultValue, callback);
}


// --- Inizializzazione ---
document.addEventListener('DOMContentLoaded', () => {
    // Aumento ulteriormente il ritardo per massima sicurezza sul caricamento di Turf.js e DOM
    setTimeout(() => {
        initializeMainMap();
        renderTerreniList(); // Renderizza la lista dei terreni
        updateDashboard(); // Aggiorna la dashboard con i totali

        // Gestione della visibilità iniziale delle sezioni di indirizzo, centroide e vertici
        // Saranno visibili solo se ci sono terreni con poligoni disegnati
        document.getElementById('selected-terrain-details').style.display = 'none';
        document.getElementById('coordinates-section').style.display = 'none';
        document.getElementById('polygon-vertices-section').style.display = 'none'; // Nascondi la nuova sezione

        // Se ci sono terreni precaricati, prova a selezionare il primo per inizializzare la UI
        if (terreni.length > 0) {
            selectTerreno(terreni[0].id);
        }

        document.getElementById("terreno-name-input").value = "Nuovo Terreno";

        // Aggiungi l'event listener per il tasto Invio sulla casella di ricerca indirizzo
        const indirizzoSearchInput = document.getElementById('indirizzo_search_sidebar');
        if (indirizzoSearchInput) {
            indirizzoSearchInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault(); // Evita il comportamento predefinito del tasto Invio (es. invio form)
                    goToLocationSidebar();
                }
            });
        }

    }, 1000); // Ritardo aumentato a 1000ms (1 secondo) per massima sicurezza
});
