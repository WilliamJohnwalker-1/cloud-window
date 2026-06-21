import React, { useMemo } from 'react';
import type { City } from '../types';
import { getProvincesFromCities, getCitiesByProvince, getProvinceForCity } from '../utils/provinceMapping';

interface ProvinceCityFilterProps {
  cities: City[];
  selectedProvinceId: string | null;
  selectedCityId: string | null;
  onProvinceChange: (province: string | null) => void;
  onCityChange: (cityId: string | null) => void;
  showProvince?: boolean;
}

export const ProvinceCityFilter: React.FC<ProvinceCityFilterProps> = ({
  cities,
  selectedProvinceId,
  selectedCityId,
  onProvinceChange,
  onCityChange,
  showProvince = true,
}) => {
  const provinces = useMemo(() => {
    const mappedProvinces = getProvincesFromCities(cities);
    const hasUnmapped = cities.some((city) => !getProvinceForCity(city.name));
    if (hasUnmapped) {
      return [...mappedProvinces, '未知省份'];
    }
    return mappedProvinces;
  }, [cities]);

  const displayCities = useMemo(() => {
    if (!selectedProvinceId) {
      return cities;
    }

    if (selectedProvinceId === '未知省份') {
      return cities.filter((city) => !getProvinceForCity(city.name));
    }

    return getCitiesByProvince(cities, selectedProvinceId);
  }, [cities, selectedProvinceId]);

  const handleProvinceClick = (province: string | null) => {
    onProvinceChange(province);
    onCityChange(null); // Reset city selection when province changes
  };

  return (
    <div className="space-y-4">
      {showProvince && (
        <div className="space-y-2">
          <p className="text-sm text-white/60">省份筛选</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleProvinceClick(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                selectedProvinceId === null
                  ? 'bg-white/15 border-white/30 text-white'
                  : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              全部省份
            </button>
            {provinces.map((province) => (
              <button
                key={province}
                type="button"
                onClick={() => handleProvinceClick(province)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  selectedProvinceId === province
                    ? 'bg-white/15 border-white/30 text-white'
                    : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                {province}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm text-white/60">城市筛选</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onCityChange(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              selectedCityId === null
                ? 'bg-white/15 border-white/30 text-white'
                : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            全部城市
          </button>
          {displayCities.map((city) => (
            <button
              key={city.id}
              type="button"
              onClick={() => onCityChange(city.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                selectedCityId === city.id
                  ? 'bg-white/15 border-white/30 text-white'
                  : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              {city.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
