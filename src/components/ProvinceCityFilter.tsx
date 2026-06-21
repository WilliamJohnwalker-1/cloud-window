import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../theme';
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

export default function ProvinceCityFilter({
  cities,
  selectedProvinceId,
  selectedCityId,
  onProvinceChange,
  onCityChange,
  showProvince = true,
}: ProvinceCityFilterProps) {
  const provinces = useMemo(() => {
    const mappedProvinces = getProvincesFromCities(cities);
    const hasUnmapped = cities.some(c => !getProvinceForCity(c.name));
    if (hasUnmapped) {
      return [...mappedProvinces, '未知省份'];
    }
    return mappedProvinces;
  }, [cities]);

  const displayCities = useMemo(() => {
    if (!selectedProvinceId) return cities;
    if (selectedProvinceId === '未知省份') {
      return cities.filter(c => !getProvinceForCity(c.name));
    }
    return getCitiesByProvince(cities, selectedProvinceId);
  }, [cities, selectedProvinceId]);

  const handleProvincePress = (province: string | null) => {
    if (selectedProvinceId !== province) {
      onProvinceChange(province);
      onCityChange(null); // Reset city on province change
    }
  };

  return (
    <View style={styles.container}>
      {showProvince && (
        <View style={styles.rowContainer}>
          <Text style={styles.label}>省份</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow} contentContainerStyle={styles.scrollContent}>
            <TouchableOpacity
              style={[styles.chip, selectedProvinceId === null && styles.chipActive]}
              onPress={() => handleProvincePress(null)}
            >
              <Text style={[styles.chipText, selectedProvinceId === null && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
                全部省份
              </Text>
            </TouchableOpacity>
            {provinces.map((province) => (
              <TouchableOpacity
                key={province}
                style={[styles.chip, selectedProvinceId === province && styles.chipActive]}
                onPress={() => handleProvincePress(province)}
              >
                <Text style={[styles.chipText, selectedProvinceId === province && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
                  {province}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.rowContainer}>
        <Text style={styles.label}>城市</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow} contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity
            style={[styles.chip, selectedCityId === null && styles.chipActive]}
            onPress={() => onCityChange(null)}
          >
            <Text style={[styles.chipText, selectedCityId === null && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
              全部城市
            </Text>
          </TouchableOpacity>
          {displayCities.map((city) => (
            <TouchableOpacity
              key={city.id}
              style={[styles.chip, selectedCityId === city.id && styles.chipActive]}
              onPress={() => onCityChange(city.id)}
            >
              <Text style={[styles.chipText, selectedCityId === city.id && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
                {city.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  rowContainer: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  scrollRow: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: Colors.surfaceSecondary,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: Colors.pink,
  },
  chipText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
});
