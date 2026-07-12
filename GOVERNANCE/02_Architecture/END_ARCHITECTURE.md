# Forge End Architecture

## System structure

Forge Core bestaat uiteindelijk uit:

- Kernel
- Configuration Service
- Event Bus
- Logging and Audit
- Health and Runtime State
- Persistent Memory
- Mission Engine
- Mission Loop
- Learning Engine
- Capability Registry
- Capability Analysis
- Evolution Engine
- Governance Engine
- Project Memory
- Blueprint Library
- Element Library
- Prompt Composer
- AI Model Router
- Evaluator
- Tool Connectors
- Workspace Manager
- Forge Desktop / Workbench

## Forge Intelligence

Verantwoordelijk voor:

- architectuuronderzoek;
- capability discovery;
- experimenten;
- nieuwe software-representaties;
- onderzoek naar alternatieven boven traditionele broncode.

Experimentele resultaten mogen alleen na validatie en governance-goedkeuring door Forge Productivity worden gebruikt.

## Forge Productivity

Verantwoordelijk voor:

- softwareontwerp;
- implementatie;
- testen;
- refactoring;
- documentatie;
- repositorybeheer;
- builds;
- gecontroleerde releases en deployments.

## Runtime chain

Forge Launcher
→ Kernel
→ Configuration, Event Bus, Logging en Health
→ Persistent State
→ Mission Loop
→ Governance
→ Forge Desktop

Er mag slechts één gezaghebbende runtime-state bestaan.

De Desktop toont uitsluitend gegevens uit de echte runtime en bevat geen afzonderlijke demo- of placeholderlogica.
