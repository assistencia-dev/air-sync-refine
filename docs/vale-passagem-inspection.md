# Inspeção do Sistema de Vale Passagem

Fonte visual: https://valepassagem-d8edi3fl.manus.space

## Finalidade observada

Painel interno de RH para controlar colaboradores, recargas de vale passagem, histórico e financeiro.

## Navegação observada

- Visão geral
- Colaboradores
- Nova recarga
- Histórico
- Financeiro

## Perfil exibido

Operador RH / Equipe administrativa / DBS AIR.

## Dados da visão geral

A visão geral apresenta colaboradores ativos, pendências de renovação, recargas no mês, total movimentado, radar de renovação, próximos vencimentos, horários e ativação de alertas.

## Dados da tela Colaboradores

A tela permite buscar por nome ou unidade, cadastrar novo colaborador, editar e excluir cadastro. O exemplo visual exibe Vitor, unidade IBMEC, R$ 9,40 por viagem e 2 viagens/dia.

## Diretriz de integração

O módulo deve entrar no projeto DBS Air como área interna exclusiva do operador nativo DBS123/DBSASSISTENCIA123, reutilizando a sessão existente. A integração deve preservar dados e autenticação do projeto de passagem; não deve duplicar login nem copiar dados sem confirmação.
