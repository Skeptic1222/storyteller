/**
 * ImportPreview Component
 * Full preview and inline editing of extracted data before saving
 */

import { useState } from 'react';
import {
  Users, Globe, MapPin, BookOpen, FileText, ChevronDown, ChevronRight,
  Edit3, Trash2, Plus, Check, X, Save, AlertCircle, Sparkles,
  Sword, Building2, Flame
} from 'lucide-react';

const TABS = [
  { id: 'characters', label: 'Characters', icon: Users, color: 'blue' },
  { id: 'world', label: 'World', icon: Globe, color: 'emerald' },
  { id: 'locations', label: 'Locations', icon: MapPin, color: 'cyan' },
  { id: 'items', label: 'Items', icon: Sword, color: 'orange' },
  { id: 'factions', label: 'Factions', icon: Building2, color: 'rose' },
  { id: 'lore', label: 'Lore', icon: BookOpen, color: 'purple' },
  { id: 'synopsis', label: 'Synopsis', icon: FileText, color: 'amber' }
];

export default function ImportPreview({ data, onSave, onCancel, isSaving }) {
  const [activeTab, setActiveTab] = useState('characters');
  const [editedData, setEditedData] = useState(data);
  const [editingItem, setEditingItem] = useState(null);

  const updateItem = (type, index, updates) => {
    setEditedData(prev => {
      if (type === 'world' || type === 'synopsis') {
        return { ...prev, [type]: { ...prev[type], ...updates } };
      }
      const items = [...(prev[type] || [])];
      items[index] = { ...items[index], ...updates };
      return { ...prev, [type]: items };
    });
  };

  const deleteItem = (type, index) => {
    if (type === 'world' || type === 'synopsis') {
      setEditedData(prev => ({ ...prev, [type]: null }));
    } else {
      setEditedData(prev => ({
        ...prev,
        [type]: prev[type].filter((_, i) => i !== index)
      }));
    }
  };

  const addItem = (type) => {
    const templates = {
      characters: { name: 'New Character', role: 'supporting', description: '', gender: 'unknown', age_group: 'unknown' },
      locations: { name: 'New Location', location_type: 'other', description: '', atmosphere: '' },
      items: { name: 'New Item', item_type: 'misc', description: '', rarity: 'common' },
      factions: { name: 'New Faction', faction_type: 'guild', description: '', goals: [], methods: [] },
      lore: { title: 'New Lore Entry', entry_type: 'custom', content: '', importance: 50 }
    };

    if (templates[type]) {
      setEditedData(prev => ({
        ...prev,
        [type]: [...(prev[type] || []), templates[type]]
      }));
      // Start editing the new item
      const newIndex = (editedData[type]?.length || 0);
      setEditingItem({ type, index: newIndex });
    }
  };

  const getCounts = () => ({
    characters: editedData.characters?.length || 0,
    world: editedData.world ? 1 : 0,
    locations: editedData.locations?.length || 0,
    items: editedData.items?.length || 0,
    factions: editedData.factions?.length || 0,
    lore: editedData.lore?.length || 0,
    synopsis: editedData.synopsis ? 1 : 0,
    relationships: editedData.relationships?.length || 0
  });

  const counts = getCounts();

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-center justify-between">
        <div>
          <h3 className="font-medium text-slate-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            Review Extracted Data
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            Edit any fields before saving to your Story Bible
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-slate-400 hover:text-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(editedData)}
            disabled={isSaving}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {isSaving ? (
              <span className="animate-pulse">Saving...</span>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save All ({counts.characters + counts.locations + counts.items + counts.factions + counts.lore + (counts.world ? 1 : 0) + (counts.synopsis ? 1 : 0)} items)
              </>
            )}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700 overflow-x-auto">
        {TABS.map(tab => {
          const count = counts[tab.id];
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? `text-${tab.color}-400 border-b-2 border-${tab.color}-400`
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {count > 0 && (
                <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                  isActive ? `bg-${tab.color}-500/20` : 'bg-slate-700'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="p-4 max-h-[60vh] overflow-y-auto">
        {activeTab === 'characters' && (
          <EntityList
            items={editedData.characters || []}
            type="characters"
            editingItem={editingItem}
            setEditingItem={setEditingItem}
            updateItem={updateItem}
            deleteItem={deleteItem}
            addItem={addItem}
            renderItem={(char, isEditing, onEdit) => (
              <CharacterCard
                character={char}
                isEditing={isEditing}
                onEdit={onEdit}
              />
            )}
          />
        )}

        {activeTab === 'world' && (
          <WorldEditor
            world={editedData.world}
            onUpdate={(updates) => updateItem('world', 0, updates)}
            onDelete={() => deleteItem('world', 0)}
          />
        )}

        {activeTab === 'locations' && (
          <EntityList
            items={editedData.locations || []}
            type="locations"
            editingItem={editingItem}
            setEditingItem={setEditingItem}
            updateItem={updateItem}
            deleteItem={deleteItem}
            addItem={addItem}
            renderItem={(loc, isEditing, onEdit) => (
              <LocationCard
                location={loc}
                isEditing={isEditing}
                onEdit={onEdit}
              />
            )}
          />
        )}

        {activeTab === 'items' && (
          <EntityList
            items={editedData.items || []}
            type="items"
            editingItem={editingItem}
            setEditingItem={setEditingItem}
            updateItem={updateItem}
            deleteItem={deleteItem}
            addItem={addItem}
            renderItem={(item, isEditing, onEdit) => (
              <ItemCard
                item={item}
                isEditing={isEditing}
                onEdit={onEdit}
              />
            )}
          />
        )}

        {activeTab === 'factions' && (
          <EntityList
            items={editedData.factions || []}
            type="factions"
            editingItem={editingItem}
            setEditingItem={setEditingItem}
            updateItem={updateItem}
            deleteItem={deleteItem}
            addItem={addItem}
            renderItem={(faction, isEditing, onEdit) => (
              <FactionCard
                faction={faction}
                isEditing={isEditing}
                onEdit={onEdit}
              />
            )}
          />
        )}

        {activeTab === 'lore' && (
          <EntityList
            items={editedData.lore || []}
            type="lore"
            editingItem={editingItem}
            setEditingItem={setEditingItem}
            updateItem={updateItem}
            deleteItem={deleteItem}
            addItem={addItem}
            renderItem={(lore, isEditing, onEdit) => (
              <LoreCard
                lore={lore}
                isEditing={isEditing}
                onEdit={onEdit}
              />
            )}
          />
        )}

        {activeTab === 'synopsis' && (
          <SynopsisEditor
            synopsis={editedData.synopsis}
            onUpdate={(updates) => updateItem('synopsis', 0, updates)}
            onDelete={() => deleteItem('synopsis', 0)}
          />
        )}
      </div>
    </div>
  );
}

function EntityList({ items, type, editingItem, setEditingItem, updateItem, deleteItem, addItem, renderItem }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-500 mb-4">No {type} extracted</p>
        <button
          onClick={() => addItem(type)}
          className="px-4 py-2 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 rounded-lg transition-colors flex items-center gap-2 mx-auto"
        >
          <Plus className="w-4 h-4" />
          Add {type.slice(0, -1)}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const isEditing = editingItem?.type === type && editingItem?.index === index;

        return (
          <div key={index} className="group relative">
            {renderItem(
              item,
              isEditing,
              (updates) => updateItem(type, index, updates)
            )}

            {/* Action buttons */}
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isEditing && (
                <>
                  <button
                    onClick={() => setEditingItem({ type, index })}
                    className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded"
                    title="Edit"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => deleteItem(type, index)}
                    className="p-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
              {isEditing && (
                <button
                  onClick={() => setEditingItem(null)}
                  className="p-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded"
                  title="Done editing"
                >
                  <Check className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Add button */}
      <button
        onClick={() => addItem(type)}
        className="w-full p-3 border-2 border-dashed border-slate-600 hover:border-purple-500/50 rounded-lg text-slate-500 hover:text-purple-400 transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" />
        Add {type.slice(0, -1)}
      </button>
    </div>
  );
}

function CharacterCard({ character, isEditing, onEdit }) {
  if (isEditing) {
    return (
      <div className="p-4 bg-slate-800 rounded-lg border border-purple-500/30 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Name</label>
            <input
              value={character.name || ''}
              onChange={(e) => onEdit({ name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Role</label>
            <select
              value={character.role || 'supporting'}
              onChange={(e) => onEdit({ role: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="protagonist">Protagonist</option>
              <option value="antagonist">Antagonist</option>
              <option value="supporting">Supporting</option>
              <option value="minor">Minor</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Gender</label>
            <select
              value={character.gender || 'unknown'}
              onChange={(e) => onEdit({ gender: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non-binary">Non-binary</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Age Group</label>
            <select
              value={character.age_group || 'unknown'}
              onChange={(e) => onEdit({ age_group: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="child">Child</option>
              <option value="teen">Teen</option>
              <option value="young_adult">Young Adult</option>
              <option value="adult">Adult</option>
              <option value="middle_aged">Middle Aged</option>
              <option value="elderly">Elderly</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400">Description</label>
          <textarea
            value={character.description || ''}
            onChange={(e) => onEdit({ description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm resize-none"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">Voice Description (for TTS)</label>
          <input
            value={character.voice_description || ''}
            onChange={(e) => onEdit({ voice_description: e.target.value })}
            placeholder="How should this character sound?"
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
          {character.name?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-100">{character.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              character.role === 'protagonist' ? 'bg-emerald-500/20 text-emerald-400' :
              character.role === 'antagonist' ? 'bg-red-500/20 text-red-400' :
              'bg-slate-600 text-slate-400'
            }`}>
              {character.role}
            </span>
            {character._inferred?.gender && (
              <span className="text-xs text-purple-400" title="Inferred from context">*</span>
            )}
          </div>
          <p className="text-sm text-slate-400 line-clamp-2 mt-1">{character.description}</p>
          <div className="flex gap-2 mt-2 text-xs text-slate-500">
            <span>{character.gender}</span>
            <span>•</span>
            <span>{character.age_group}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LocationCard({ location, isEditing, onEdit }) {
  if (isEditing) {
    return (
      <div className="p-4 bg-slate-800 rounded-lg border border-cyan-500/30 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Name</label>
            <input
              value={location.name || ''}
              onChange={(e) => onEdit({ name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Type</label>
            <select
              value={location.location_type || 'other'}
              onChange={(e) => onEdit({ location_type: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="planet">Planet</option>
              <option value="continent">Continent</option>
              <option value="country">Country</option>
              <option value="region">Region</option>
              <option value="city">City</option>
              <option value="town">Town</option>
              <option value="building">Building</option>
              <option value="room">Room</option>
              <option value="wilderness">Wilderness</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400">Description</label>
          <textarea
            value={location.description || ''}
            onChange={(e) => onEdit({ description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm resize-none"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">Atmosphere</label>
          <input
            value={location.atmosphere || ''}
            onChange={(e) => onEdit({ atmosphere: e.target.value })}
            placeholder="The mood or feeling of this place"
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors">
      <div className="flex items-start gap-3">
        <MapPin className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-100">{location.name}</span>
            <span className="text-xs px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded">
              {location.location_type}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">{location.description}</p>
          {location.atmosphere && (
            <p className="text-xs text-slate-500 mt-1 italic">{location.atmosphere}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemCard({ item, isEditing, onEdit }) {
  if (isEditing) {
    return (
      <div className="p-4 bg-slate-800 rounded-lg border border-orange-500/30 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Name</label>
            <input
              value={item.name || ''}
              onChange={(e) => onEdit({ name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Type</label>
            <select
              value={item.item_type || 'misc'}
              onChange={(e) => onEdit({ item_type: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="weapon">Weapon</option>
              <option value="armor">Armor</option>
              <option value="vehicle">Vehicle</option>
              <option value="artifact">Artifact</option>
              <option value="tool">Tool</option>
              <option value="consumable">Consumable</option>
              <option value="clothing">Clothing</option>
              <option value="treasure">Treasure</option>
              <option value="misc">Misc</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Rarity</label>
            <select
              value={item.rarity || 'common'}
              onChange={(e) => onEdit({ rarity: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="common">Common</option>
              <option value="uncommon">Uncommon</option>
              <option value="rare">Rare</option>
              <option value="very_rare">Very Rare</option>
              <option value="legendary">Legendary</option>
              <option value="artifact">Artifact</option>
              <option value="unique">Unique</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Is Magical</label>
            <select
              value={item.is_magical ? 'yes' : 'no'}
              onChange={(e) => onEdit({ is_magical: e.target.value === 'yes' })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400">Description</label>
          <textarea
            value={item.description || ''}
            onChange={(e) => onEdit({ description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm resize-none"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">Properties/Abilities</label>
          <input
            value={item.properties || ''}
            onChange={(e) => onEdit({ properties: e.target.value })}
            placeholder="Special properties or abilities"
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors">
      <div className="flex items-start gap-3">
        <Sword className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-100">{item.name}</span>
            <span className="text-xs px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded">
              {item.item_type}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              item.rarity === 'legendary' ? 'bg-yellow-500/20 text-yellow-400' :
              item.rarity === 'very_rare' ? 'bg-purple-500/20 text-purple-400' :
              item.rarity === 'rare' ? 'bg-blue-500/20 text-blue-400' :
              item.rarity === 'uncommon' ? 'bg-green-500/20 text-green-400' :
              'bg-slate-600 text-slate-400'
            }`}>
              {item.rarity}
            </span>
            {item.is_magical && (
              <span className="text-xs px-2 py-0.5 bg-violet-500/20 text-violet-400 rounded">✨ Magical</span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1">{item.description}</p>
          {item.properties && (
            <p className="text-xs text-slate-500 mt-1 italic">{item.properties}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FactionCard({ faction, isEditing, onEdit }) {
  if (isEditing) {
    return (
      <div className="p-4 bg-slate-800 rounded-lg border border-rose-500/30 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Name</label>
            <input
              value={faction.name || ''}
              onChange={(e) => onEdit({ name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Type</label>
            <select
              value={faction.faction_type || 'guild'}
              onChange={(e) => onEdit({ faction_type: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="guild">Guild</option>
              <option value="kingdom">Kingdom</option>
              <option value="empire">Empire</option>
              <option value="religion">Religion</option>
              <option value="cult">Cult</option>
              <option value="corporation">Corporation</option>
              <option value="military">Military</option>
              <option value="criminal">Criminal</option>
              <option value="secret_society">Secret Society</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Alignment</label>
            <select
              value={faction.alignment || 'neutral'}
              onChange={(e) => onEdit({ alignment: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="lawful_good">Lawful Good</option>
              <option value="neutral_good">Neutral Good</option>
              <option value="chaotic_good">Chaotic Good</option>
              <option value="lawful_neutral">Lawful Neutral</option>
              <option value="neutral">Neutral</option>
              <option value="chaotic_neutral">Chaotic Neutral</option>
              <option value="lawful_evil">Lawful Evil</option>
              <option value="neutral_evil">Neutral Evil</option>
              <option value="chaotic_evil">Chaotic Evil</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Size</label>
            <select
              value={faction.size || 'medium'}
              onChange={(e) => onEdit({ size: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="tiny">Tiny (2-10)</option>
              <option value="small">Small (11-50)</option>
              <option value="medium">Medium (51-200)</option>
              <option value="large">Large (201-1000)</option>
              <option value="huge">Huge (1000+)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400">Description</label>
          <textarea
            value={faction.description || ''}
            onChange={(e) => onEdit({ description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm resize-none"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">Goals (comma-separated)</label>
          <input
            value={Array.isArray(faction.goals) ? faction.goals.join(', ') : (faction.goals || '')}
            onChange={(e) => onEdit({ goals: e.target.value.split(',').map(g => g.trim()).filter(g => g) })}
            placeholder="Power, wealth, conquest..."
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors">
      <div className="flex items-start gap-3">
        <Building2 className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-100">{faction.name}</span>
            <span className="text-xs px-2 py-0.5 bg-rose-500/20 text-rose-400 rounded">
              {faction.faction_type}
            </span>
            {faction.alignment && (
              <span className={`text-xs px-2 py-0.5 rounded ${
                faction.alignment?.includes('good') ? 'bg-green-500/20 text-green-400' :
                faction.alignment?.includes('evil') ? 'bg-red-500/20 text-red-400' :
                'bg-slate-600 text-slate-400'
              }`}>
                {faction.alignment?.replace(/_/g, ' ')}
              </span>
            )}
            {faction.size && (
              <span className="text-xs text-slate-500">({faction.size})</span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1">{faction.description}</p>
          {faction.goals && Array.isArray(faction.goals) && faction.goals.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {faction.goals.slice(0, 3).map((goal, i) => (
                <span key={i} className="text-xs px-2 py-0.5 bg-slate-700 text-slate-400 rounded">
                  {goal}
                </span>
              ))}
              {faction.goals.length > 3 && (
                <span className="text-xs text-slate-500">+{faction.goals.length - 3} more</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoreCard({ lore, isEditing, onEdit }) {
  if (isEditing) {
    return (
      <div className="p-4 bg-slate-800 rounded-lg border border-purple-500/30 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Title</label>
            <input
              value={lore.title || ''}
              onChange={(e) => onEdit({ title: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Type</label>
            <select
              value={lore.entry_type || 'custom'}
              onChange={(e) => onEdit({ entry_type: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            >
              <option value="history">History</option>
              <option value="magic">Magic</option>
              <option value="religion">Religion</option>
              <option value="faction">Faction</option>
              <option value="item">Item</option>
              <option value="creature">Creature</option>
              <option value="event">Event</option>
              <option value="rule">Rule</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400">Content</label>
          <textarea
            value={lore.content || ''}
            onChange={(e) => onEdit({ content: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm resize-none"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">Importance (0-100)</label>
          <input
            type="number"
            min="0"
            max="100"
            value={lore.importance || 50}
            onChange={(e) => onEdit({ importance: parseInt(e.target.value) || 50 })}
            className="w-24 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors">
      <div className="flex items-start gap-3">
        <BookOpen className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-100">{lore.title}</span>
            <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded">
              {lore.entry_type}
            </span>
            <span className="text-xs text-slate-500">({lore.importance}%)</span>
          </div>
          <p className="text-sm text-slate-400 mt-1 line-clamp-2">{lore.content}</p>
        </div>
      </div>
    </div>
  );
}

function WorldEditor({ world, onUpdate, onDelete }) {
  const [isEditing, setIsEditing] = useState(false);

  if (!world) {
    return (
      <div className="text-center py-8 text-slate-500">
        No world extracted
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="p-4 bg-slate-800 rounded-lg border border-emerald-500/30 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Name</label>
            <input
              value={world.name || ''}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Genre</label>
            <input
              value={world.genre || ''}
              onChange={(e) => onUpdate({ genre: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400">Description</label>
          <textarea
            value={world.description || ''}
            onChange={(e) => onUpdate({ description: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm resize-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Time Period</label>
            <input
              value={world.time_period || ''}
              onChange={(e) => onUpdate({ time_period: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Tone</label>
            <input
              value={world.tone || ''}
              onChange={(e) => onUpdate({ tone: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
            />
          </div>
        </div>
        <button
          onClick={() => setIsEditing(false)}
          className="px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg"
        >
          Done Editing
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-slate-800/50 rounded-lg">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-emerald-400" />
          <span className="font-medium text-slate-100">{world.name}</span>
          <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">
            {world.genre}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded"
          >
            <Edit3 className="w-3 h-3" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-400">{world.description}</p>
      <div className="flex gap-4 mt-3 text-xs text-slate-500">
        <span>Period: {world.time_period || 'Unknown'}</span>
        <span>Tone: {world.tone || 'Unknown'}</span>
      </div>
    </div>
  );
}

function SynopsisEditor({ synopsis, onUpdate, onDelete }) {
  const [isEditing, setIsEditing] = useState(false);

  if (!synopsis) {
    return (
      <div className="text-center py-8 text-slate-500">
        No synopsis extracted
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="p-4 bg-slate-800 rounded-lg border border-amber-500/30 space-y-3">
        <div>
          <label className="text-xs text-slate-400">Title</label>
          <input
            value={synopsis.title || ''}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">Logline</label>
          <input
            value={synopsis.logline || ''}
            onChange={(e) => onUpdate({ logline: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">Synopsis</label>
          <textarea
            value={synopsis.synopsis || ''}
            onChange={(e) => onUpdate({ synopsis: e.target.value })}
            rows={5}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 text-sm resize-none"
          />
        </div>
        <button
          onClick={() => setIsEditing(false)}
          className="px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg"
        >
          Done Editing
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-slate-800/50 rounded-lg">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-amber-400" />
          <span className="font-medium text-slate-100">{synopsis.title || 'Untitled Story'}</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded"
          >
            <Edit3 className="w-3 h-3" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      {synopsis.logline && (
        <p className="text-sm text-amber-300 italic mb-2">{synopsis.logline}</p>
      )}
      <p className="text-sm text-slate-400">{synopsis.synopsis}</p>
    </div>
  );
}
