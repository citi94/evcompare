# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a single-page web application that compares fuel costs between Electric Vehicles (EV) and Internal Combustion Engine (ICE) vehicles. The entire application is contained within `index.html` - a self-contained HTML file with embedded CSS and JavaScript.

## Architecture

The application uses a reactive state management pattern with the following key components:

- **State Management**: Central `state` object holds all calculator values (efficiency, costs, units, settings)
- **Elements Object**: Maps all DOM elements for easy access throughout the codebase
- **Equivalence Calculation**: Core feature that maintains cost equivalence between EV and ICE when parameters change
- **Lock System**: Allows users to lock up to 2 parameters while adjusting others
- **Unit Conversion**: Comprehensive system supporting multiple unit types (distance, energy, volume, efficiency)

## Key Technical Features

### Interactive Controls
- Sliders and editable number inputs that sync bidirectionally
- Value displays can be modified by dragging sliders or typing exact values
- Lock checkboxes prevent parameters from being auto-adjusted during equivalence calculations

### Unit System
The application supports multiple unit preferences:
- Distance: Miles/Kilometers  
- Energy: kWh/Wh
- Volume: Litres/UK Gallons/US Gallons
- EV Efficiency: mi/kWh, km/kWh, kWh/100mi, kWh/100km, Wh/mi, Wh/km
- Fuel Efficiency: mpg (UK), mpg (US), km/L, L/100km

### Equivalence Engine
The `maintainEquivalence()` function automatically adjusts unlocked parameters when others change, ensuring the cost comparison remains meaningful. It respects the lock system and handles complex unit conversions.

## Development Notes

- All code is contained in `index.html` - no build process or external dependencies
- CSS uses modern features (flexbox, grid, CSS variables for theming)
- JavaScript is vanilla ES6+ with no framework dependencies
- Responsive design with mobile-first approach
- Uses semantic color coding (blue for EV, red for ICE)

## Testing

Open `index.html` directly in a web browser - no server required. Test the interactive features:
- Slider/input synchronization
- Unit conversions accuracy  
- Lock system behavior
- Equivalence calculations
- Responsive layout on different screen sizes